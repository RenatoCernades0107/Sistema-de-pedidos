"use client";

import { useState } from "react";
import { PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ChatProvider } from "@/app/(app)/cotizaciones/chat-store";
import type { ChatResumen } from "@/app/(app)/cotizaciones/acciones";
import { ChatSidebar } from "./chat-sidebar";
import { ChatThread } from "./chat-thread";
import { ChatComposer } from "./chat-composer";

export function VistaCotizaciones({ chatsIniciales }: { chatsIniciales: ChatResumen[] }) {
  return (
    <ChatProvider chatsIniciales={chatsIniciales}>
      <Contenido />
    </ChatProvider>
  );
}

function Contenido() {
  const [sheetAbierto, setSheetAbierto] = useState(false);

  return (
    // Alto fijo, como en WhatsApp: al bajar por el hilo solo se desplazan los
    // mensajes, y las barras laterales y el composer se quedan en su sitio. Con
    // `h-full` no bastaba: el `main` del AppShell crece con su contenido, así que
    // el chat se estiraba y se desplazaba la página entera. El alto es el de la
    // pantalla menos la cabecera (`h-14` + 1px de borde) y, en móvil, menos el
    // `pb-20` que el `main` reserva para las pestañas de abajo.
    <div className="flex h-[calc(100dvh-3.5rem-1px-5rem)] min-h-0 md:h-[calc(100dvh-3.5rem-1px)]">
      <aside className="hidden w-72 shrink-0 border-r md:block">
        <ChatSidebar />
      </aside>

      <Sheet open={sheetAbierto} onOpenChange={setSheetAbierto}>
        <SheetContent side="left" className="w-72 p-0">
          <ChatSidebar alSeleccionar={() => setSheetAbierto(false)} />
        </SheetContent>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b p-2 md:hidden">
            <SheetTrigger render={<Button variant="ghost" size="icon-sm" />}>
              <PanelLeft />
              <span className="sr-only">Abrir chats</span>
            </SheetTrigger>
            <p className="text-sm font-medium">Cotizaciones</p>
          </div>
          <ChatThread />
          <ChatComposer />
        </div>
      </Sheet>
    </div>
  );
}
