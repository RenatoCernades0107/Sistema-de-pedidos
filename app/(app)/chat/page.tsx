import { MessageCircle } from "lucide-react";

/** Sin conversación elegida. En el celular no se ve: ahí manda la lista. */
export default function Page() {
  return (
    <div className="text-muted-foreground m-auto flex max-w-xs flex-col items-center gap-3 p-6 text-center text-sm">
      <span className="bg-muted grid size-12 place-items-center rounded-full">
        <MessageCircle className="size-5" />
      </span>
      <p>
        Elige una conversación de la lista, o empieza un mensaje directo. En <strong>General</strong> está todo el
        equipo.
      </p>
    </div>
  );
}
