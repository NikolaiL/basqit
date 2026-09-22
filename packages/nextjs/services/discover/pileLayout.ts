/** Stable scatter prevents the pile from jumping while typing or hydrating. */
export function pilePosition(symbol: string, index: number, count: number) {
  let seed = 2166136261;
  for (const character of symbol) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  const x = random();
  const height = random();
  const stride = Math.max(1, Math.ceil(count / 12));
  const grounded = index % stride === 0;
  const floorCount = Math.ceil(count / stride);
  const slot = Math.floor(index / stride);
  return {
    grounded,
    mobileGrounded: grounded && slot % 2 === 0,
    x: grounded ? 5 + ((slot + 0.1 + x * 0.8) / floorCount) * 90 : 5 + x * 90,
    y: 230 + Math.sin(x * 17) * 18 + (height - 0.5) * 50,
    mobileY: 282 + Math.sin(x * 17) * 10 + (height - 0.5) * 34,
    tilt: (random() - 0.5) * 90,
  };
}
