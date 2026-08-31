"use client";

import { useParams } from "next/navigation";
import { DetallePedido } from "@/components/detalle-pedido";

export default function Page() {
  const params = useParams<{ codigo: string }>();
  return <DetallePedido codigo={decodeURIComponent(params.codigo)} />;
}
