/**
 * Qué es una contraseña segura, en un solo sitio: lo usan el esquema que valida en
 * el servidor y la barra de los formularios, y no pueden discrepar. Si la barra
 * dijera "verde" y el servidor la rechazara, la barra sería peor que no tenerla.
 *
 * Es puro (sin React ni servidor) para poder importarse desde los dos lados.
 *
 * Las contraseñas temporales que genera la Edge Function (12 caracteres de un
 * alfabeto sin símbolos) no pasan por aquí: solo las que la propia persona elige.
 */

export const LARGO_MINIMO_PASSWORD = 10;
export const LARGO_MAXIMO_PASSWORD = 72;

/** Lo mínimo que ni siquiera cuenta como intento: por debajo, siempre insegura. */
const LARGO_DEBIL = 8;

export interface Requisito {
  clave: "largo" | "minuscula" | "mayuscula" | "numero";
  texto: string;
  cumple: boolean;
}

export type NivelPassword = "insegura" | "incompleta" | "segura";

export interface Fortaleza {
  nivel: NivelPassword;
  requisitos: Requisito[];
  /** Cuántos requisitos se cumplen, de `requisitos.length`. */
  cumplidos: number;
  /** Frase corta para la etiqueta de la barra. */
  etiqueta: string;
  /** Qué falta, en el orden en que conviene corregirlo; `null` si es segura. */
  motivo: string | null;
}

/**
 * Trozos que hacen insegura una contraseña aunque cumpla las reglas ("Password1").
 * Es una lista corta de lo que de verdad se teclea —incluida la contraseña de los
 * usuarios de prueba—, no un diccionario.
 */
const OBVIAS = [
  "password",
  "contrasena",
  "contraseña",
  "qwerty",
  "asdfgh",
  "123456",
  "abcdef",
  "654321",
  "plexi",
  "admin",
  "letmein",
  "iloveyou",
];

function esObvia(password: string): boolean {
  const minuscula = password.toLowerCase();
  if (OBVIAS.some((o) => minuscula.includes(o))) return true;
  // Un solo carácter repetido ("aaaaaaaaaa", "Aaaa1111") no aporta nada aunque sea largo.
  return new Set(minuscula).size <= 3;
}

export function evaluarPassword(password: string): Fortaleza {
  const requisitos: Requisito[] = [
    { clave: "largo", texto: `Al menos ${LARGO_MINIMO_PASSWORD} caracteres`, cumple: password.length >= LARGO_MINIMO_PASSWORD },
    { clave: "minuscula", texto: "Una letra minúscula", cumple: /\p{Ll}/u.test(password) },
    { clave: "mayuscula", texto: "Una letra mayúscula", cumple: /\p{Lu}/u.test(password) },
    { clave: "numero", texto: "Un número", cumple: /\d/.test(password) },
  ];
  const cumplidos = requisitos.filter((r) => r.cumple).length;
  const obvia = password.length > 0 && esObvia(password);

  let nivel: NivelPassword;
  if (obvia || password.length < LARGO_DEBIL || cumplidos <= 2) nivel = "insegura";
  else if (cumplidos < requisitos.length) nivel = "incompleta";
  else nivel = "segura";

  const faltante = requisitos.find((r) => !r.cumple);
  const motivo =
    nivel === "segura"
      ? null
      : obvia
        ? "Es demasiado común o predecible. Prueba con algo menos evidente"
        : faltante
          ? `Falta: ${faltante.texto.toLowerCase()}`
          : null;

  const etiqueta =
    nivel === "segura" ? "Segura" : nivel === "incompleta" ? "Casi: todavía falta algo" : "Insegura";

  return { nivel, requisitos, cumplidos, etiqueta, motivo };
}
