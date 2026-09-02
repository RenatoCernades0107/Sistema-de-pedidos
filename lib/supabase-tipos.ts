export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      adjuntos: {
        Row: {
          creado_en: string
          id: string
          mime_type: string | null
          nombre_archivo: string
          pedido_id: string
          storage_path: string
          subido_por: string | null
          tamano_bytes: number | null
          tipo: Database["public"]["Enums"]["tipo_adjunto"]
        }
        Insert: {
          creado_en?: string
          id?: string
          mime_type?: string | null
          nombre_archivo: string
          pedido_id: string
          storage_path: string
          subido_por?: string | null
          tamano_bytes?: number | null
          tipo: Database["public"]["Enums"]["tipo_adjunto"]
        }
        Update: {
          creado_en?: string
          id?: string
          mime_type?: string | null
          nombre_archivo?: string
          pedido_id?: string
          storage_path?: string
          subido_por?: string | null
          tamano_bytes?: number | null
          tipo?: Database["public"]["Enums"]["tipo_adjunto"]
        }
        Relationships: [
          {
            foreignKeyName: "adjuntos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjuntos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjuntos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjuntos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adjuntos_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      departamentos: {
        Row: {
          id: number
          nombre: string
        }
        Insert: {
          id?: never
          nombre: string
        }
        Update: {
          id?: never
          nombre?: string
        }
        Relationships: []
      }
      envios_provincia: {
        Row: {
          departamento_id: number
          flete_pagado: boolean
          monto_flete: number
          nombre_agencia: string | null
          nombre_persona_recoge: string | null
          numero_documento: string | null
          observaciones_envio: string | null
          pedido_id: string
          provincia_id: number | null
          telefono_persona_recoge: string | null
          tipo_documento: Database["public"]["Enums"]["tipo_documento"]
        }
        Insert: {
          departamento_id: number
          flete_pagado?: boolean
          monto_flete?: number
          nombre_agencia?: string | null
          nombre_persona_recoge?: string | null
          numero_documento?: string | null
          observaciones_envio?: string | null
          pedido_id: string
          provincia_id?: number | null
          telefono_persona_recoge?: string | null
          tipo_documento?: Database["public"]["Enums"]["tipo_documento"]
        }
        Update: {
          departamento_id?: number
          flete_pagado?: boolean
          monto_flete?: number
          nombre_agencia?: string | null
          nombre_persona_recoge?: string | null
          numero_documento?: string | null
          observaciones_envio?: string | null
          pedido_id?: string
          provincia_id?: number | null
          telefono_persona_recoge?: string | null
          tipo_documento?: Database["public"]["Enums"]["tipo_documento"]
        }
        Relationships: [
          {
            foreignKeyName: "envios_provincia_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pertenece_al_departamento"
            columns: ["provincia_id", "departamento_id"]
            isOneToOne: false
            referencedRelation: "provincias"
            referencedColumns: ["id", "departamento_id"]
          },
        ]
      }
      historial_estados: {
        Row: {
          creado_en: string
          estado: Database["public"]["Enums"]["estado_pedido"]
          id: string
          motivo: string | null
          pedido_id: string
          rol: Database["public"]["Enums"]["rol"] | null
          usuario_id: string | null
        }
        Insert: {
          creado_en?: string
          estado: Database["public"]["Enums"]["estado_pedido"]
          id?: string
          motivo?: string | null
          pedido_id: string
          rol?: Database["public"]["Enums"]["rol"] | null
          usuario_id?: string | null
        }
        Update: {
          creado_en?: string
          estado?: Database["public"]["Enums"]["estado_pedido"]
          id?: string
          motivo?: string | null
          pedido_id?: string
          rol?: Database["public"]["Enums"]["rol"] | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_auditoria: {
        Row: {
          campo: string
          creado_en: string
          id: number
          pedido_id: string
          usuario_id: string | null
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          campo: string
          creado_en?: string
          id?: never
          pedido_id: string
          usuario_id?: string | null
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          campo?: string
          creado_en?: string
          id?: never
          pedido_id?: string
          usuario_id?: string | null
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      notificaciones: {
        Row: {
          creado_en: string
          cuerpo: string
          destinatario_id: string
          enviada_en: string | null
          error: string | null
          id: number
          intentos: number
          pedido_id: string | null
          tipo: Database["public"]["Enums"]["tipo_notificacion"]
          titulo: string
          tomada_en: string | null
          url: string
        }
        Insert: {
          creado_en?: string
          cuerpo: string
          destinatario_id: string
          enviada_en?: string | null
          error?: string | null
          id?: number
          intentos?: number
          pedido_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_notificacion"]
          titulo: string
          tomada_en?: string | null
          url?: string
        }
        Update: {
          creado_en?: string
          cuerpo?: string
          destinatario_id?: string
          enviada_en?: string | null
          error?: string | null
          id?: number
          intentos?: number
          pedido_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_notificacion"]
          titulo?: string
          tomada_en?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      pagos: {
        Row: {
          fecha: string
          id: string
          metodo: Database["public"]["Enums"]["metodo_pago"]
          monto: number
          nota: string | null
          pedido_id: string
          registrado_por: string | null
        }
        Insert: {
          fecha?: string
          id?: string
          metodo: Database["public"]["Enums"]["metodo_pago"]
          monto: number
          nota?: string | null
          pedido_id: string
          registrado_por?: string | null
        }
        Update: {
          fecha?: string
          id?: string
          metodo?: Database["public"]["Enums"]["metodo_pago"]
          monto?: number
          nota?: string | null
          pedido_id?: string
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          actualizado_en: string
          cantidad: number
          codigo: string
          creado_por: string | null
          detalle: string
          direccion_entrega: string | null
          es_provincia: boolean
          estado: Database["public"]["Enums"]["estado_pedido"]
          fecha_anulacion: string | null
          fecha_creacion: string
          fecha_entrega: string | null
          fecha_prometida: string
          id: string
          lugar_entrega: Database["public"]["Enums"]["lugar_entrega"]
          monto_pagado: number
          monto_total: number
          motivo: string | null
          nombre_cliente: string
          numero_comprobante: string | null
          observaciones: string | null
          pagado: boolean | null
          plazo_credito_dias: number | null
          responsable_id: string | null
          saldo: number | null
          telefono_cliente: string | null
          tipo_pago: Database["public"]["Enums"]["tipo_pago"]
          tipo_producto_terminado:
            | Database["public"]["Enums"]["producto_terminado"]
            | null
          tipos_pedido: Database["public"]["Enums"]["tipo_pedido"][]
          ubicacion_actual: Database["public"]["Enums"]["ubicacion"]
        }
        Insert: {
          actualizado_en?: string
          cantidad: number
          codigo: string
          creado_por?: string | null
          detalle?: string
          direccion_entrega?: string | null
          es_provincia: boolean
          estado?: Database["public"]["Enums"]["estado_pedido"]
          fecha_anulacion?: string | null
          fecha_creacion?: string
          fecha_entrega?: string | null
          fecha_prometida: string
          id?: string
          lugar_entrega: Database["public"]["Enums"]["lugar_entrega"]
          monto_pagado?: number
          monto_total?: number
          motivo?: string | null
          nombre_cliente: string
          numero_comprobante?: string | null
          observaciones?: string | null
          pagado?: boolean | null
          plazo_credito_dias?: number | null
          responsable_id?: string | null
          saldo?: number | null
          telefono_cliente?: string | null
          tipo_pago: Database["public"]["Enums"]["tipo_pago"]
          tipo_producto_terminado?:
            | Database["public"]["Enums"]["producto_terminado"]
            | null
          tipos_pedido: Database["public"]["Enums"]["tipo_pedido"][]
          ubicacion_actual?: Database["public"]["Enums"]["ubicacion"]
        }
        Update: {
          actualizado_en?: string
          cantidad?: number
          codigo?: string
          creado_por?: string | null
          detalle?: string
          direccion_entrega?: string | null
          es_provincia?: boolean
          estado?: Database["public"]["Enums"]["estado_pedido"]
          fecha_anulacion?: string | null
          fecha_creacion?: string
          fecha_entrega?: string | null
          fecha_prometida?: string
          id?: string
          lugar_entrega?: Database["public"]["Enums"]["lugar_entrega"]
          monto_pagado?: number
          monto_total?: number
          motivo?: string | null
          nombre_cliente?: string
          numero_comprobante?: string | null
          observaciones?: string | null
          pagado?: boolean | null
          plazo_credito_dias?: number | null
          responsable_id?: string | null
          saldo?: number | null
          telefono_cliente?: string | null
          tipo_pago?: Database["public"]["Enums"]["tipo_pago"]
          tipo_producto_terminado?:
            | Database["public"]["Enums"]["producto_terminado"]
            | null
          tipos_pedido?: Database["public"]["Enums"]["tipo_pedido"][]
          ubicacion_actual?: Database["public"]["Enums"]["ubicacion"]
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      provincias: {
        Row: {
          departamento_id: number
          id: number
          nombre: string
        }
        Insert: {
          departamento_id: number
          id?: never
          nombre: string
        }
        Update: {
          departamento_id?: number
          id?: never
          nombre?: string
        }
        Relationships: [
          {
            foreignKeyName: "provincias_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "departamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      suscripciones_push: {
        Row: {
          auth: string
          creado_en: string
          endpoint: string
          id: string
          navegador: string | null
          p256dh: string
          usada_en: string | null
          usuario_id: string
        }
        Insert: {
          auth: string
          creado_en?: string
          endpoint: string
          id?: string
          navegador?: string | null
          p256dh: string
          usada_en?: string | null
          usuario_id: string
        }
        Update: {
          auth?: string
          creado_en?: string
          endpoint?: string
          id?: string
          navegador?: string | null
          p256dh?: string
          usada_en?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suscripciones_push_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      trabajadores: {
        Row: {
          activo: boolean
          creado_en: string
          id: string
          nombre: string
          usuario_id: string | null
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          id?: string
          nombre: string
          usuario_id?: string | null
        }
        Update: {
          activo?: boolean
          creado_en?: string
          id?: string
          nombre?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trabajadores_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          activo: boolean
          creado_en: string
          debe_cambiar_password: boolean
          email: string
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["rol"]
          usuario: string
        }
        Insert: {
          activo?: boolean
          creado_en?: string
          debe_cambiar_password?: boolean
          email: string
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["rol"]
          usuario: string
        }
        Update: {
          activo?: boolean
          creado_en?: string
          debe_cambiar_password?: boolean
          email?: string
          id?: string
          nombre?: string
          rol?: Database["public"]["Enums"]["rol"]
          usuario?: string
        }
        Relationships: []
      }
    }
    Views: {
      auditoria_pedido: {
        Row: {
          campo: string | null
          creado_en: string | null
          id: number | null
          pedido_id: string | null
          usuario: string | null
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "logs_auditoria_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      historial_pedido: {
        Row: {
          creado_en: string | null
          estado: Database["public"]["Enums"]["estado_pedido"] | null
          id: string | null
          motivo: string | null
          pedido_id: string | null
          rol: Database["public"]["Enums"]["rol"] | null
          usuario: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historial_estados_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      pagos_pedido: {
        Row: {
          fecha: string | null
          id: string | null
          metodo: Database["public"]["Enums"]["metodo_pago"] | null
          monto: number | null
          pedido_id: string | null
          usuario: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_admin: {
        Row: {
          cantidad: number | null
          codigo: string | null
          creado_por: string | null
          departamento: string | null
          departamento_id: number | null
          detalle: string | null
          direccion_entrega: string | null
          es_provincia: boolean | null
          estado: Database["public"]["Enums"]["estado_pedido"] | null
          fecha_anulacion: string | null
          fecha_creacion: string | null
          fecha_entrega: string | null
          fecha_prometida: string | null
          flete_pagado: boolean | null
          id: string | null
          lugar_entrega: Database["public"]["Enums"]["lugar_entrega"] | null
          monto_flete: number | null
          monto_pagado: number | null
          monto_total: number | null
          motivo: string | null
          nombre_agencia: string | null
          nombre_cliente: string | null
          nombre_persona_recoge: string | null
          numero_comprobante: string | null
          numero_documento: string | null
          observaciones: string | null
          observaciones_envio: string | null
          pagado: boolean | null
          plazo_credito_dias: number | null
          provincia: string | null
          provincia_id: number | null
          responsable: string | null
          responsable_id: string | null
          saldo: number | null
          telefono_cliente: string | null
          telefono_persona_recoge: string | null
          tiene_comprobante: boolean | null
          tipo_documento: Database["public"]["Enums"]["tipo_documento"] | null
          tipo_pago: Database["public"]["Enums"]["tipo_pago"] | null
          tipo_producto_terminado:
            | Database["public"]["Enums"]["producto_terminado"]
            | null
          tipos_pedido: Database["public"]["Enums"]["tipo_pedido"][] | null
          ubicacion_actual: Database["public"]["Enums"]["ubicacion"] | null
        }
        Relationships: [
          {
            foreignKeyName: "envios_provincia_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pertenece_al_departamento"
            columns: ["provincia_id", "departamento_id"]
            isOneToOne: false
            referencedRelation: "provincias"
            referencedColumns: ["id", "departamento_id"]
          },
          {
            foreignKeyName: "pedidos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_logistica: {
        Row: {
          cantidad: number | null
          codigo: string | null
          creado_por: string | null
          departamento: string | null
          departamento_id: number | null
          detalle: string | null
          direccion_entrega: string | null
          es_provincia: boolean | null
          estado: Database["public"]["Enums"]["estado_pedido"] | null
          fecha_anulacion: string | null
          fecha_creacion: string | null
          fecha_entrega: string | null
          fecha_prometida: string | null
          flete_pagado: boolean | null
          id: string | null
          lugar_entrega: Database["public"]["Enums"]["lugar_entrega"] | null
          monto_flete: number | null
          motivo: string | null
          nombre_agencia: string | null
          nombre_cliente: string | null
          nombre_persona_recoge: string | null
          numero_documento: string | null
          observaciones: string | null
          observaciones_envio: string | null
          provincia: string | null
          provincia_id: number | null
          responsable: string | null
          responsable_id: string | null
          telefono_cliente: string | null
          telefono_persona_recoge: string | null
          tiene_comprobante: boolean | null
          tipo_documento: Database["public"]["Enums"]["tipo_documento"] | null
          tipo_producto_terminado:
            | Database["public"]["Enums"]["producto_terminado"]
            | null
          tipos_pedido: Database["public"]["Enums"]["tipo_pedido"][] | null
          ubicacion_actual: Database["public"]["Enums"]["ubicacion"] | null
        }
        Relationships: [
          {
            foreignKeyName: "envios_provincia_departamento_id_fkey"
            columns: ["departamento_id"]
            isOneToOne: false
            referencedRelation: "departamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_provincia_pertenece_al_departamento"
            columns: ["provincia_id", "departamento_id"]
            isOneToOne: false
            referencedRelation: "provincias"
            referencedColumns: ["id", "departamento_id"]
          },
          {
            foreignKeyName: "pedidos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_operaciones: {
        Row: {
          cantidad: number | null
          codigo: string | null
          departamento: string | null
          detalle: string | null
          es_provincia: boolean | null
          estado: Database["public"]["Enums"]["estado_pedido"] | null
          fecha_anulacion: string | null
          fecha_creacion: string | null
          fecha_entrega: string | null
          fecha_prometida: string | null
          id: string | null
          lugar_entrega: Database["public"]["Enums"]["lugar_entrega"] | null
          motivo: string | null
          nombre_cliente: string | null
          observaciones: string | null
          provincia: string | null
          responsable: string | null
          responsable_id: string | null
          tiene_comprobante: boolean | null
          tipo_producto_terminado:
            | Database["public"]["Enums"]["producto_terminado"]
            | null
          tipos_pedido: Database["public"]["Enums"]["tipo_pedido"][] | null
          ubicacion_actual: Database["public"]["Enums"]["ubicacion"] | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "trabajadores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      array_sin_duplicados: { Args: { a: unknown }; Returns: boolean }
      auditoria_texto: { Args: { campo: string; valor: Json }; Returns: string }
      auth_rol: { Args: never; Returns: Database["public"]["Enums"]["rol"] }
      crear_pedido: {
        Args: {
          p_abono_inicial?: number
          p_cantidad: number
          p_departamento_id?: number
          p_detalle?: string
          p_direccion_entrega?: string
          p_es_provincia: boolean
          p_fecha_prometida: string
          p_flete_pagado?: boolean
          p_lugar_entrega: Database["public"]["Enums"]["lugar_entrega"]
          p_metodo_pago?: Database["public"]["Enums"]["metodo_pago"]
          p_monto_flete?: number
          p_monto_total?: number
          p_nombre_agencia?: string
          p_nombre_cliente: string
          p_nombre_persona_recoge?: string
          p_numero_documento?: string
          p_observaciones?: string
          p_observaciones_envio?: string
          p_plazo_credito_dias?: number
          p_provincia_id?: number
          p_responsable_id?: string
          p_telefono_cliente?: string
          p_telefono_persona_recoge?: string
          p_tipo_documento?: Database["public"]["Enums"]["tipo_documento"]
          p_tipo_pago: Database["public"]["Enums"]["tipo_pago"]
          p_tipo_producto_terminado?: Database["public"]["Enums"]["producto_terminado"]
          p_tipos_pedido: Database["public"]["Enums"]["tipo_pedido"][]
          p_ubicacion_actual?: Database["public"]["Enums"]["ubicacion"]
        }
        Returns: string
      }
      debug_mi_rol: { Args: never; Returns: Json }
      despachar_push: { Args: never; Returns: undefined }
      email_de_usuario: { Args: { nombre_usuario: string }; Returns: string }
      es_admin: { Args: never; Returns: boolean }
      escritura_del_sistema: { Args: never; Returns: boolean }
      etiqueta: { Args: { valor: string }; Returns: string }
      generar_codigo_pedido: {
        Args: {
          anio?: number
          es_provincia: boolean
          tipos: Database["public"]["Enums"]["tipo_pedido"][]
        }
        Returns: string
      }
      marcar_escritura_del_sistema: {
        Args: { activa: boolean }
        Returns: undefined
      }
      marcar_password_cambiada: { Args: never; Returns: undefined }
      purgar_notificaciones: { Args: never; Returns: undefined }
      sigla_de: {
        Args: { tipos: Database["public"]["Enums"]["tipo_pedido"][] }
        Returns: string
      }
      sufijo_codigo: { Args: never; Returns: string }
      texto_notificacion: {
        Args: {
          p_codigo: string
          p_tipo: Database["public"]["Enums"]["tipo_notificacion"]
        }
        Returns: {
          cuerpo: string
          titulo: string
        }[]
      }
      tomar_notificaciones: {
        Args: { p_limite?: number }
        Returns: {
          creado_en: string
          cuerpo: string
          destinatario_id: string
          enviada_en: string | null
          error: string | null
          id: number
          intentos: number
          pedido_id: string | null
          tipo: Database["public"]["Enums"]["tipo_notificacion"]
          titulo: string
          tomada_en: string | null
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notificaciones"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      transiciones_validas: {
        Args: {
          desde: Database["public"]["Enums"]["estado_pedido"]
          es_provincia: boolean
        }
        Returns: Database["public"]["Enums"]["estado_pedido"][]
      }
      usuario_de_trabajador: {
        Args: { p_trabajador_id: string }
        Returns: string
      }
    }
    Enums: {
      estado_pedido:
        | "registrado"
        | "en_proceso"
        | "observado"
        | "listo"
        | "en_transito"
        | "entregado"
        | "anulado"
      lugar_entrega: "tienda" | "taller" | "domicilio" | "agencia"
      metodo_pago:
        | "efectivo"
        | "yape_plin"
        | "transferencia"
        | "tarjeta"
        | "otro"
      producto_terminado:
        | "cajas"
        | "porta_afiches"
        | "pivotante"
        | "letreros"
        | "letras"
        | "displays"
        | "otro"
      rol: "administracion" | "logistica" | "operaciones"
      tipo_adjunto: "diseno" | "factura" | "guia" | "foto_entrega"
      tipo_documento: "DNI" | "CE"
      tipo_notificacion: "pedido_creado" | "responsable_asignado"
      tipo_pago: "contado" | "a_cuenta" | "credito"
      tipo_pedido: "CL" | "CM" | "SP" | "PT" | "AC"
      ubicacion: "tienda" | "taller" | "agencia"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      estado_pedido: [
        "registrado",
        "en_proceso",
        "observado",
        "listo",
        "en_transito",
        "entregado",
        "anulado",
      ],
      lugar_entrega: ["tienda", "taller", "domicilio", "agencia"],
      metodo_pago: [
        "efectivo",
        "yape_plin",
        "transferencia",
        "tarjeta",
        "otro",
      ],
      producto_terminado: [
        "cajas",
        "porta_afiches",
        "pivotante",
        "letreros",
        "letras",
        "displays",
        "otro",
      ],
      rol: ["administracion", "logistica", "operaciones"],
      tipo_adjunto: ["diseno", "factura", "guia", "foto_entrega"],
      tipo_documento: ["DNI", "CE"],
      tipo_notificacion: ["pedido_creado", "responsable_asignado"],
      tipo_pago: ["contado", "a_cuenta", "credito"],
      tipo_pedido: ["CL", "CM", "SP", "PT", "AC"],
      ubicacion: ["tienda", "taller", "agencia"],
    },
  },
} as const
