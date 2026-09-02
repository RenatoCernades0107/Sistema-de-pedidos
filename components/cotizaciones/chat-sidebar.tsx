"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useChat } from "@/app/(app)/cotizaciones/chat-store";

export function ChatSidebar({ alSeleccionar }: { alSeleccionar?: () => void }) {
  const { chats, activeChatId, seleccionar, borrar } = useChat();

  return (
    <div className="flex h-full flex-col p-3">
      <Button
        variant="outline"
        className="w-full justify-start gap-2"
        onClick={() => {
          seleccionar(null);
          alSeleccionar?.();
        }}
      >
        <MessageSquarePlus className="size-4" />
        Nueva cotización
      </Button>

      <p className="eyebrow px-1 pt-4 pb-2">Chats</p>

      <ScrollArea className="-mx-1 min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 px-1">
          {chats.length === 0 && (
            <li className="text-muted-foreground px-2 py-4 text-sm">
              Todavía no hay cotizaciones.
            </li>
          )}
          {chats.map((chat) => {
            const activo = chat.chatId === activeChatId;
            return (
              <li key={chat.chatId} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    seleccionar(chat.chatId);
                    alSeleccionar?.();
                  }}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    activo
                      ? "bg-sidebar-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="w-full truncate pr-6">{chat.title}</span>
                  {chat.lastQuotation && (
                    <span className="text-primary text-xs font-medium">
                      {chat.lastQuotation.orderName} · S/ {chat.lastQuotation.totalPen.toFixed(2)}
                    </span>
                  )}
                </button>

                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100"
                      />
                    }
                  >
                    <Trash2 />
                    <span className="sr-only">Borrar chat</span>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Borrar esta cotización?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se borra el chat &quot;{chat.title}&quot;. Esto no anula ninguna
                        cotización que ya se haya creado en Odoo.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => borrar(chat.chatId)}>
                        Borrar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </div>
  );
}
