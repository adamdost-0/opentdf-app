export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

export function trustedEndpoint(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Expected a trusted HTTPS endpoint without credentials or query',
    );
  }
  return url.href.replace(/\/$/, '');
}

export function reportFailure(error: unknown): void {
  console.error(error instanceof Error ? error.message : 'Operation failed');
  process.exitCode = 1;
}
