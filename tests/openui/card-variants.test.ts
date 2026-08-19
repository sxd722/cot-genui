import { describe, expect, it } from "vitest";
import librarySpec from "../../src/openui/generated/system-prompt.spec.json";

describe("bounded card surface variants", () => {
  it("exposes only bounded GeneratedCard and CardDeck visual props", () => {
    const generatedCard = librarySpec.components.GeneratedCard as unknown as { signature: string };
    const cardDeck = librarySpec.components.CardDeck as unknown as { signature: string };
    expect(generatedCard.signature).toContain("variant?");
    expect(generatedCard.signature).toContain("density?");
    expect(cardDeck.signature).toContain("layout?");
    expect(generatedCard.signature).not.toContain("className");
  });
});
