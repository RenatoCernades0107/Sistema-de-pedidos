import { describe, expect, it } from "vitest";
import { siguienteDe } from "./productos";

describe("siguienteDe", () => {
  it("sigue el correlativo del prefijo, con el ancho que ya se usa", () => {
    expect(siguienteDe("ACC", ["ACC001", "ACC054", "ACC006", "PEG019"])).toBe("ACC055");
    expect(siguienteDe("PEG", ["PEG002", "PEG019"])).toBe("PEG020");
    expect(siguienteDe("ACC", ["ACC0999"])).toBe("ACC1000");
  });

  it("sin ninguno, empieza en 1 con el ancho pedido", () => {
    expect(siguienteDe("PL", [], 4)).toBe("PL0001");
    expect(siguienteDe("PL", ["PLX01", "F7E024"], 4)).toBe("PL0001");
  });
});
