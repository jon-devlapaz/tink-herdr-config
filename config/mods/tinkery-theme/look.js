export function nextLook(background) {
  if (typeof background !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(background)) {
    throw new Error(`Unsupported theme background: ${background}`);
  }
  const [r, g, b] = [1, 3, 5].map(i => parseInt(background.slice(i, i + 2), 16));
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
  const appearance = light ? "dark" : "light";
  return { appearance, theme: `tinkery-${appearance}` };
}

export function updateLook(source, look) {
  const settings = JSON.parse(source);
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Herdr settings must be a JSON object");
  }
  if (!["light", "dark"].includes(look.appearance) || look.theme !== `tinkery-${look.appearance}`) {
    throw new Error("Invalid Tinkery appearance");
  }
  return JSON.stringify({ ...settings, ...look }, null, 2) + "\n";
}
