/** El bucket público donde se guardan las fotos de los modelos 3D. */
export const BUCKET_MINIATURAS = "miniaturas";

/** La URL pública de una miniatura guardada en el bucket `miniaturas`. */
export function urlMiniatura(ruta: string | null | undefined): string | null {
  if (!ruta) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET_MINIATURAS}/${ruta}`;
}
