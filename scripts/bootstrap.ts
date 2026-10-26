import {
  AttributeRuleTypeEnum,
  authTokenInterceptor,
  ConditionBooleanTypeEnum,
  PlatformClient,
  SubjectMappingOperatorEnum,
} from '@opentdf/sdk';
import { platformConnect } from '@opentdf/sdk/platform';
import { required, reportFailure, trustedEndpoint } from './settings.js';

const marker = 'opentdf-azure-fixture';
const markerValue = 'project-alpha-v1';

async function notFound<T>(
  operation: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof platformConnect.ConnectError &&
      error.code === platformConnect.Code.NotFound
    ) {
      return undefined;
    }
    throw error;
  }
}

async function main() {
  const platformUrl = trustedEndpoint(required('OPENTDF_PLATFORM_URL'));
  const token = required('OPENTDF_ADMIN_TOKEN');
  const attributeFqn = required('OPENTDF_ATTRIBUTE');
  const parsed = new URL(attributeFqn);
  const segments = /^\/attr\/([a-z0-9_-]+)\/value\/([a-z0-9_-]+)$/.exec(
    parsed.pathname,
  );
  if (parsed.protocol !== 'https:' || !segments?.[1] || !segments[2]) {
    throw new Error('OPENTDF_ATTRIBUTE must be an HTTPS attribute FQN');
  }
  const [attributeName, valueName] = [segments[1], segments[2]];
  const kasUrl = trustedEndpoint(
    process.env.OPENTDF_KAS_URL ?? `${platformUrl}/kas`,
  );
  if (new URL(kasUrl).origin !== new URL(platformUrl).origin) {
    throw new Error('KAS must share the configured platform origin');
  }
  const platform = new PlatformClient({
    platformUrl,
    interceptors: [authTokenInterceptor(async () => token)],
  }).v1;
  const metadata = { labels: { [marker]: markerValue } };

  if (process.argv.includes('--revoke')) {
    const id = required('OPENTDF_MAPPING_ID');
    const { subjectMapping } = await platform.subjectMapping.getSubjectMapping({
      id,
    });
    if (
      !subjectMapping ||
      subjectMapping.metadata?.labels[marker] !== markerValue ||
      subjectMapping.attributeValue?.fqn !== attributeFqn
    ) {
      throw new Error(
        'Refusing to revoke a mapping outside this marked fixture',
      );
    }
    await platform.subjectMapping.deleteSubjectMapping({ id });
    console.log(JSON.stringify({ revokedSubjectMappingId: id, attributeFqn }));
    return;
  }

  const namespaceFqn = parsed.origin;
  const namespaceResponse =
    (await notFound(() =>
      platform.namespace.getNamespace({
        identifier: { case: 'fqn', value: namespaceFqn },
      }),
    )) ??
    (await platform.namespace.createNamespace({
      name: parsed.hostname,
      metadata,
    }));
  const namespace = namespaceResponse.namespace;
  if (!namespace?.id || namespace.active === false) {
    throw new Error('Fixture namespace missing or inactive');
  }
  const definitionFqn = `${namespaceFqn}/attr/${attributeName}`;
  const attributeResponse =
    (await notFound(() =>
      platform.attributes.getAttribute({
        identifier: { case: 'fqn', value: definitionFqn },
      }),
    )) ??
    (await platform.attributes.createAttribute({
      namespaceId: namespace.id,
      name: attributeName,
      rule: AttributeRuleTypeEnum.ALL_OF,
      values: [valueName],
      metadata,
    }));
  const attribute = attributeResponse.attribute;
  if (
    !attribute?.id ||
    attribute.active === false ||
    attribute.rule !== AttributeRuleTypeEnum.ALL_OF
  ) {
    throw new Error('Fixture attribute must be active and use ALL_OF');
  }
  const value =
    attribute.values.find((candidate) => candidate.value === valueName) ??
    (
      await platform.attributes.createAttributeValue({
        attributeId: attribute.id,
        value: valueName,
        metadata,
      })
    ).value;
  if (!value?.id || value.active === false) {
    throw new Error('Fixture attribute value missing or inactive');
  }

  const kasResponse =
    (await notFound(() =>
      platform.keyAccessServerRegistry.getKeyAccessServer({
        identifier: { case: 'uri', value: kasUrl },
      }),
    )) ??
    (await platform.keyAccessServerRegistry.createKeyAccessServer({
      uri: kasUrl,
      name: 'azure-mvp',
      metadata,
    }));
  const kas = kasResponse.keyAccessServer;
  if (!kas?.id) throw new Error('KAS registration returned no identifier');
  if (!attribute.grants.some((grant) => grant.id === kas.id)) {
    await platform.attributes.assignKeyAccessServerToAttribute({
      attributeKeyAccessServer: {
        attributeId: attribute.id,
        keyAccessServerId: kas.id,
      },
    });
  }

  let mappingId: string | undefined;
  let offset = 0;
  do {
    const page = await platform.subjectMapping.listSubjectMappings({
      namespaceId: namespace.id,
      pagination: { limit: 100, offset },
    });
    const existing = page.subjectMappings.filter(
      (mapping) => mapping.metadata?.labels[marker] === markerValue,
    );
    if (existing.length > 1 || (mappingId && existing.length > 0)) {
      throw new Error(
        'Multiple marked fixture mappings require operator review',
      );
    }
    if (existing[0]) {
      const mapping = existing[0];
      const conditions = mapping.subjectConditionSet?.subjectSets.flatMap(
        (set) => set.conditionGroups.flatMap((group) => group.conditions),
      );
      if (
        mapping.attributeValue?.id !== value.id ||
        mapping.actions.length !== 1 ||
        mapping.actions[0]?.name !== 'read' ||
        conditions?.length !== 1 ||
        conditions[0]?.subjectExternalSelectorValue !== '.roles[]' ||
        conditions[0]?.operator !== SubjectMappingOperatorEnum.IN ||
        conditions[0]?.subjectExternalValues.length !== 1 ||
        conditions[0]?.subjectExternalValues[0] !== 'Project.Alpha'
      ) {
        throw new Error(
          'Existing fixture policy differs; review instead of overwriting it',
        );
      }
      mappingId = mapping.id;
    }
    const next = page.pagination?.nextOffset ?? 0;
    if (next !== 0 && next <= offset) {
      throw new Error('Policy pagination did not advance');
    }
    offset = next;
  } while (offset !== 0);

  if (!mappingId) {
    const result = await platform.subjectMapping.createSubjectMapping({
      attributeValueId: value.id,
      namespaceId: namespace.id,
      actions: [{ name: 'read' }],
      newSubjectConditionSet: {
        subjectSets: [
          {
            conditionGroups: [
              {
                booleanOperator: ConditionBooleanTypeEnum.AND,
                conditions: [
                  {
                    subjectExternalSelectorValue: '.roles[]',
                    operator: SubjectMappingOperatorEnum.IN,
                    subjectExternalValues: ['Project.Alpha'],
                  },
                ],
              },
            ],
          },
        ],
        metadata,
      },
      metadata,
    });
    mappingId = result.subjectMapping?.id;
  }
  if (!mappingId) throw new Error('Subject mapping returned no identifier');
  console.log(
    JSON.stringify(
      { attributeFqn, kasId: kas.id, subjectMappingId: mappingId },
      null,
      2,
    ),
  );
}

main().catch(reportFailure);
