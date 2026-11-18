import { redirect } from "next/navigation";

/** Los sobrantes viven ahora en el almacén, en su pestaña. */
export default function Page() {
  redirect("/almacen?vista=sobrantes");
}
