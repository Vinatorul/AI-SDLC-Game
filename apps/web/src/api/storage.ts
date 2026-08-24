export function adminTokenKey(code: string) {
  return `ai-sdlc:admin:${code}`;
}

export function playerTokenKey(code: string) {
  return `ai-sdlc:player:${code}`;
}
