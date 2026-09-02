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
    <div className="flex h-full min-h-0">
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
