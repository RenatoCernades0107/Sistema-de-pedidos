/** El logo de la empresa para los PDF que arma el servidor. */

import { readFile } from "node:fs/promises";
import path from "node:path";

let logo: Promise<Uint8Array | null> | null = null;

/** El logo se lee del disco una vez por proceso. Si falta, el PDF sale sin él. */
export const leerLogo = () =>
  (logo ??= readFile(path.join(process.cwd(), "public", "logo-plexiacril.png"))
    .then((b) => new Uint8Array(b))
    .catch(() => null));
