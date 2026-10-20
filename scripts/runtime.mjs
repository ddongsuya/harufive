export function assertSupportedRuntime(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || major < 22 || major === 23 || (major === 22 && minor < 16)) {
    throw new Error('하루다섯은 Node 22.16.0 이상인 22.x 또는 Node 24 이상이 필요합니다. Node 24를 권장합니다.');
  }
}
assertSupportedRuntime();
