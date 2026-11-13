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
          linea_posicion: number | null
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
          linea_posicion?: number | null
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
          linea_posicion?: number | null
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
      cad_diseno_versiones: {
        Row: {
          acomodo: Json | null
          aprobado_en: string | null
          aprobado_por: string | null
          codigo: string | null
          color: string | null
          creado_en: string
          creado_por: string | null
          diseno_id: string
          estado: string
          grupo_plancha_id: string | null
          id: string
          origen: string
          parametros: Json
          plantilla: string
          version: number
          version_plantilla: number | null
        }
        Insert: {
          acomodo?: Json | null
          aprobado_en?: string | null
          aprobado_por?: string | null
          codigo?: string | null
          color?: string | null
          creado_en?: string
          creado_por?: string | null
          diseno_id: string
          estado?: string
          grupo_plancha_id?: string | null
          id?: string
          origen: string
          parametros?: Json
          plantilla: string
          version: number
          version_plantilla?: number | null
        }
        Update: {
          acomodo?: Json | null
          aprobado_en?: string | null
          aprobado_por?: string | null
          codigo?: string | null
          color?: string | null
          creado_en?: string
          creado_por?: string | null
          diseno_id?: string
          estado?: string
          grupo_plancha_id?: string | null
          id?: string
          origen?: string
          parametros?: Json
          plantilla?: string
          version?: number
          version_plantilla?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cad_diseno_versiones_grupo_plancha_id_fkey"
            columns: ["grupo_plancha_id"]
            isOneToOne: false
            referencedRelation: "grupos_plancha"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_diseno_versiones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cad_diseno_versiones_diseno_id_fkey"
            columns: ["diseno_id"]
            isOneToOne: false
            referencedRelation: "cad_disenos"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_disenos: {
        Row: {
          actualizado_en: string
          creado_en: string
          creado_por: string | null
          id: string
          nombre: string
          version_actual: number
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          creado_por?: string | null
          id?: string
          nombre?: string
          version_actual?: number
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          creado_por?: string | null
          id?: string
          nombre?: string
          version_actual?: number
        }
        Relationships: [
          {
            foreignKeyName: "cad_disenos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cad_mensajes: {
        Row: {
          contenido: string
          creado_en: string
          diseno_id: string
          herramientas: Json | null
          id: string
          referencias: Json | null
          rol: string
        }
        Insert: {
          contenido: string
          creado_en?: string
          diseno_id: string
          herramientas?: Json | null
          id?: string
          referencias?: Json | null
          rol: string
        }
        Update: {
          contenido?: string
          creado_en?: string
          diseno_id?: string
          herramientas?: Json | null
          id?: string
          referencias?: Json | null
          rol?: string
        }
        Relationships: [
          {
            foreignKeyName: "cad_mensajes_diseno_id_fkey"
            columns: ["diseno_id"]
            isOneToOne: false
            referencedRelation: "cad_disenos"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion: {
        Row: {
          actualizado_en: string
          actualizado_por: string | null
          clave: string
          valor: Json
        }
        Insert: {
          actualizado_en?: string
          actualizado_por?: string | null
          clave: string
          valor: Json
        }
        Update: {
          actualizado_en?: string
          actualizado_por?: string | null
          clave?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizacion_productos: {
        Row: {
          cantidad: number
          corte: Json | null
          cotizacion_id: string
          descripcion: string | null
          diseno_version_id: string | null
          id: string
          importe: number | null
          indicaciones: string | null
          materiales_usados: Json | null
          odoo_produccion_id: number | null
          odoo_produccion_nombre: string | null
          odoo_product_id: number
          planchas_usadas: number | null
          posicion: number
          precio_unitario: number
          produccion_cerrada: boolean
          producto_codigo: string | null
          producto_nombre: string
          terminado: Json | null
          tipo: Database["public"]["Enums"]["tipo_linea"]
        }
        Insert: {
          cantidad: number
          corte?: Json | null
          cotizacion_id: string
          descripcion?: string | null
          diseno_version_id?: string | null
          id?: string
          importe?: number | null
          indicaciones?: string | null
          materiales_usados?: Json | null
          odoo_produccion_id?: number | null
          odoo_produccion_nombre?: string | null
          odoo_product_id: number
          planchas_usadas?: number | null
          posicion: number
          precio_unitario: number
          produccion_cerrada?: boolean
          producto_codigo?: string | null
          producto_nombre: string
          terminado?: Json | null
          tipo?: Database["public"]["Enums"]["tipo_linea"]
        }
        Update: {
          cantidad?: number
          corte?: Json | null
          cotizacion_id?: string
          descripcion?: string | null
          diseno_version_id?: string | null
          id?: string
          importe?: number | null
          indicaciones?: string | null
          materiales_usados?: Json | null
          odoo_produccion_id?: number | null
          odoo_produccion_nombre?: string | null
          odoo_product_id?: number
          planchas_usadas?: number | null
          posicion?: number
          precio_unitario?: number
          produccion_cerrada?: boolean
          producto_codigo?: string | null
          producto_nombre?: string
          terminado?: Json | null
          tipo?: Database["public"]["Enums"]["tipo_linea"]
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_productos_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          actualizado_en: string
          anulada_en_odoo: boolean
          canal: Database["public"]["Enums"]["canal_cotizacion"]
          chat_agente_id: string | null
          cliente_documento: string | null
          cliente_nombre: string
          cliente_telefono: string | null
          confirmada_en_odoo: boolean
          creado_en: string
          creado_por: string | null
          error_anulacion: string | null
          error_confirmacion: string | null
          error_sincronizacion: string | null
          error_stock: string | null
          id: string
          monto_impuestos: number | null
          monto_sin_impuestos: number | null
          monto_total: number | null
          notas: string | null
          odoo_order_id: number | null
          odoo_order_name: string | null
          odoo_partner_id: number
          pedido_id: string | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado: boolean
        }
        Insert: {
          actualizado_en?: string
          anulada_en_odoo?: boolean
          canal?: Database["public"]["Enums"]["canal_cotizacion"]
          chat_agente_id?: string | null
          cliente_documento?: string | null
          cliente_nombre: string
          cliente_telefono?: string | null
          confirmada_en_odoo?: boolean
          creado_en?: string
          creado_por?: string | null
          error_anulacion?: string | null
          error_confirmacion?: string | null
          error_sincronizacion?: string | null
          error_stock?: string | null
          id?: string
          monto_impuestos?: number | null
          monto_sin_impuestos?: number | null
          monto_total?: number | null
          notas?: string | null
          odoo_order_id?: number | null
          odoo_order_name?: string | null
          odoo_partner_id: number
          pedido_id?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado?: boolean
        }
        Update: {
          actualizado_en?: string
          anulada_en_odoo?: boolean
          canal?: Database["public"]["Enums"]["canal_cotizacion"]
          chat_agente_id?: string | null
          cliente_documento?: string | null
          cliente_nombre?: string
          cliente_telefono?: string | null
          confirmada_en_odoo?: boolean
          creado_en?: string
          creado_por?: string | null
          error_anulacion?: string | null
          error_confirmacion?: string | null
          error_sincronizacion?: string | null
          error_stock?: string | null
          id?: string
          monto_impuestos?: number | null
          monto_sin_impuestos?: number | null
          monto_total?: number | null
          notas?: string | null
          odoo_order_id?: number | null
          odoo_order_name?: string | null
          odoo_partner_id?: number
          pedido_id?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_operaciones"
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
      formatos_plancha: {
        Row: {
          activo: boolean
          ancho_cm: number
          codigo_odoo: string
          grupo_id: string
          id: string
          largo_cm: number
          nota: string | null
          por_verificar: boolean
          sku_compartido: boolean
        }
        Insert: {
          activo?: boolean
          ancho_cm: number
          codigo_odoo: string
          grupo_id: string
          id?: string
          largo_cm: number
          nota?: string | null
          por_verificar?: boolean
          sku_compartido?: boolean
        }
        Update: {
          activo?: boolean
          ancho_cm?: number
          codigo_odoo?: string
          grupo_id?: string
          id?: string
          largo_cm?: number
          nota?: string | null
          por_verificar?: boolean
          sku_compartido?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "formatos_plancha_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_plancha"
            referencedColumns: ["id"]
          },
        ]
      }
      grupos_plancha: {
        Row: {
          detalle: string
          espesor_mm: number
          id: string
          material: string
          rotable: boolean
          sobrantes_activo: boolean
          variante: string
        }
        Insert: {
          detalle?: string
          espesor_mm: number
          id?: string
          material: string
          rotable?: boolean
          sobrantes_activo?: boolean
          variante?: string
        }
        Update: {
          detalle?: string
          espesor_mm?: number
          id?: string
          material?: string
          rotable?: boolean
          sobrantes_activo?: boolean
          variante?: string
        }
        Relationships: []
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
      pt_colores: {
        Row: {
          id: number
          nombre: string
        }
        Insert: {
          id?: number
          nombre: string
        }
        Update: {
          id?: number
          nombre?: string
        }
        Relationships: []
      }
      pt_espesores: {
        Row: {
          aplicacion: string | null
          espesor_max_mm: number
          espesor_min_mm: number
          estimado: boolean
          id: string
          material: string | null
          nota: string | null
          orden: number
          producto: string
        }
        Insert: {
          aplicacion?: string | null
          espesor_max_mm: number
          espesor_min_mm: number
          estimado?: boolean
          id?: string
          material?: string | null
          nota?: string | null
          orden?: number
          producto: string
        }
        Update: {
          aplicacion?: string | null
          espesor_max_mm?: number
          espesor_min_mm?: number
          estimado?: boolean
          id?: string
          material?: string | null
          nota?: string | null
          orden?: number
          producto?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_espesores_producto_fkey"
            columns: ["producto"]
            isOneToOne: false
            referencedRelation: "pt_productos"
            referencedColumns: ["codigo"]
          },
        ]
      }
      pt_materiales: {
        Row: {
          categoria: string | null
          id: number
          nombre: string
        }
        Insert: {
          categoria?: string | null
          id?: number
          nombre: string
        }
        Update: {
          categoria?: string | null
          id?: number
          nombre?: string
        }
        Relationships: []
      }
      pt_medidas: {
        Row: {
          altura_cm: number | null
          altura_max_cm: number | null
          diametro_cm: number | null
          estimado: boolean
          formato: string | null
          id: string
          medida_1_cm: number | null
          medida_2_cm: number | null
          medida_3_cm: number | null
          nota: string | null
          orden: number
          producto: string
        }
        Insert: {
          altura_cm?: number | null
          altura_max_cm?: number | null
          diametro_cm?: number | null
          estimado?: boolean
          formato?: string | null
          id?: string
          medida_1_cm?: number | null
          medida_2_cm?: number | null
          medida_3_cm?: number | null
          nota?: string | null
          orden?: number
          producto: string
        }
        Update: {
          altura_cm?: number | null
          altura_max_cm?: number | null
          diametro_cm?: number | null
          estimado?: boolean
          formato?: string | null
          id?: string
          medida_1_cm?: number | null
          medida_2_cm?: number | null
          medida_3_cm?: number | null
          nota?: string | null
          orden?: number
          producto?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_medidas_producto_fkey"
            columns: ["producto"]
            isOneToOne: false
            referencedRelation: "pt_productos"
            referencedColumns: ["codigo"]
          },
        ]
      }
      pt_opciones: {
        Row: {
          clase: Database["public"]["Enums"]["pt_clase_opcion"]
          extra: number
          id: number
          nombre: string
        }
        Insert: {
          clase: Database["public"]["Enums"]["pt_clase_opcion"]
          extra?: number
          id?: number
          nombre: string
        }
        Update: {
          clase?: Database["public"]["Enums"]["pt_clase_opcion"]
          extra?: number
          id?: number
          nombre?: string
        }
        Relationships: []
      }
      pt_producto_color: {
        Row: {
          color_id: number
          producto: string
        }
        Insert: {
          color_id: number
          producto: string
        }
        Update: {
          color_id?: number
          producto?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_producto_color_color_id_fkey"
            columns: ["color_id"]
            isOneToOne: false
            referencedRelation: "pt_colores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_producto_color_producto_fkey"
            columns: ["producto"]
            isOneToOne: false
            referencedRelation: "pt_productos"
            referencedColumns: ["codigo"]
          },
        ]
      }
      pt_producto_material: {
        Row: {
          componente: string | null
          especificacion: string | null
          id: string
          material_id: number
          opcional: boolean
          producto: string
        }
        Insert: {
          componente?: string | null
          especificacion?: string | null
          id?: string
          material_id: number
          opcional?: boolean
          producto: string
        }
        Update: {
          componente?: string | null
          especificacion?: string | null
          id?: string
          material_id?: number
          opcional?: boolean
          producto?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_producto_material_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "pt_materiales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_producto_material_producto_fkey"
            columns: ["producto"]
            isOneToOne: false
            referencedRelation: "pt_productos"
            referencedColumns: ["codigo"]
          },
        ]
      }
      pt_producto_opcion: {
        Row: {
          detalle: string | null
          opcion_id: number
          opcional: boolean
          producto: string
        }
        Insert: {
          detalle?: string | null
          opcion_id: number
          opcional?: boolean
          producto: string
        }
        Update: {
          detalle?: string | null
          opcion_id?: number
          opcional?: boolean
          producto?: string
        }
        Relationships: [
          {
            foreignKeyName: "pt_producto_opcion_opcion_id_fkey"
            columns: ["opcion_id"]
            isOneToOne: false
            referencedRelation: "pt_opciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pt_producto_opcion_producto_fkey"
            columns: ["producto"]
            isOneToOne: false
            referencedRelation: "pt_productos"
            referencedColumns: ["codigo"]
          },
        ]
      }
      pt_producto_segmento: {
        Row: {
          producto: string
          segmento_id: number
        }
        Insert: {
          producto: string
          segmento_id: number
        }
        Update: {
          producto?: string
          segmento_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "pt_producto_segmento_producto_fkey"
            columns: ["producto"]
            isOneToOne: false
            referencedRelation: "pt_productos"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "pt_producto_segmento_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "pt_segmentos"
            referencedColumns: ["id"]
          },
        ]
      }
      pt_productos: {
        Row: {
          a_medida: boolean
          activo: boolean
          actualizado_en: string
          codigo: string
          codigo_original: string | null
          contacto_alimentario: string | null
          geometria: Database["public"]["Enums"]["pt_geometria"]
          imagen_url: string | null
          nombre: string
          notas: string | null
          parametros_cad: Json | null
          plantilla_cad: string | null
          tipo: string
          usos: string | null
        }
        Insert: {
          a_medida?: boolean
          activo?: boolean
          actualizado_en?: string
          codigo: string
          codigo_original?: string | null
          contacto_alimentario?: string | null
          geometria?: Database["public"]["Enums"]["pt_geometria"]
          imagen_url?: string | null
          nombre: string
          notas?: string | null
          parametros_cad?: Json | null
          plantilla_cad?: string | null
          tipo: string
          usos?: string | null
        }
        Update: {
          a_medida?: boolean
          activo?: boolean
          actualizado_en?: string
          codigo?: string
          codigo_original?: string | null
          contacto_alimentario?: string | null
          geometria?: Database["public"]["Enums"]["pt_geometria"]
          imagen_url?: string | null
          nombre?: string
          notas?: string | null
          parametros_cad?: Json | null
          plantilla_cad?: string | null
          tipo?: string
          usos?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pt_productos_tipo_fkey"
            columns: ["tipo"]
            isOneToOne: false
            referencedRelation: "pt_tipos"
            referencedColumns: ["codigo"]
          },
        ]
      }
      pt_segmentos: {
        Row: {
          id: number
          nombre: string
          sector: string | null
        }
        Insert: {
          id?: number
          nombre: string
          sector?: string | null
        }
        Update: {
          id?: number
          nombre?: string
          sector?: string | null
        }
        Relationships: []
      }
      pt_tipos: {
        Row: {
          codigo: string
          factor_fabricacion: number
          nombre: string
          orden: number
        }
        Insert: {
          codigo: string
          factor_fabricacion?: number
          nombre: string
          orden?: number
        }
        Update: {
          codigo?: string
          factor_fabricacion?: number
          nombre?: string
          orden?: number
        }
        Relationships: []
      }
      sobrantes: {
        Row: {
          actualizado_en: string
          ancho_cm: number
          codigo: string
          color: string | null
          creado_en: string
          creado_por: string | null
          error_sincronizacion: string | null
          estado: Database["public"]["Enums"]["estado_sobrante"]
          estandar: boolean
          grupo_id: string
          id: string
          largo_cm: number
          linea_posicion: number | null
          odoo_lot_id: number | null
          origen: string
          pedido_id: string | null
          reserva_pedido_id: string | null
          reserva_posicion: number | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          ubicacion: string | null
        }
        Insert: {
          actualizado_en?: string
          ancho_cm: number
          codigo?: string
          color?: string | null
          creado_en?: string
          creado_por?: string | null
          error_sincronizacion?: string | null
          estado?: Database["public"]["Enums"]["estado_sobrante"]
          estandar?: boolean
          grupo_id: string
          id?: string
          largo_cm: number
          linea_posicion?: number | null
          odoo_lot_id?: number | null
          origen?: string
          pedido_id?: string | null
          reserva_pedido_id?: string | null
          reserva_posicion?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          ubicacion?: string | null
        }
        Update: {
          actualizado_en?: string
          ancho_cm?: number
          codigo?: string
          color?: string | null
          creado_en?: string
          creado_por?: string | null
          error_sincronizacion?: string | null
          estado?: Database["public"]["Enums"]["estado_sobrante"]
          estandar?: boolean
          grupo_id?: string
          id?: string
          largo_cm?: number
          linea_posicion?: number | null
          odoo_lot_id?: number | null
          origen?: string
          pedido_id?: string | null
          reserva_pedido_id?: string | null
          reserva_posicion?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          ubicacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sobrantes_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_grupo_id_fkey"
            columns: ["grupo_id"]
            isOneToOne: false
            referencedRelation: "grupos_plancha"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_reserva_pedido_id_fkey"
            columns: ["reserva_pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_reserva_pedido_id_fkey"
            columns: ["reserva_pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_reserva_pedido_id_fkey"
            columns: ["reserva_pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sobrantes_reserva_pedido_id_fkey"
            columns: ["reserva_pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
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
      clientes_cotizados: {
        Row: {
          cliente_documento: string | null
          cliente_nombre: string | null
          cliente_telefono: string | null
          odoo_partner_id: number | null
          ultima_vez: string | null
          veces: number | null
        }
        Relationships: []
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
      productos_mas_cotizados: {
        Row: {
          odoo_product_id: number | null
          ultima_vez: string | null
          veces: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      anotar_anulacion_en_odoo: {
        Args: { p_anulada: boolean; p_codigo: string; p_error?: string }
        Returns: undefined
      }
      anotar_materiales_de_terminado: {
        Args: { p_codigo: string; p_materiales: Json; p_posicion: number }
        Returns: undefined
      }
      anotar_planchas_usadas: {
        Args: { p_codigo: string; p_planchas: number; p_posicion: number }
        Returns: undefined
      }
      anotar_produccion: {
        Args: {
          p_cerrada?: boolean
          p_cotizacion: string
          p_id?: number
          p_nombre?: string
          p_posicion: number
        }
        Returns: undefined
      }
      anotar_stock_de_pedido: {
        Args: { p_codigo: string; p_descontado: boolean; p_error?: string }
        Returns: undefined
      }
      aprobar_version_diseno: {
        Args: { p_diseno_id: string; p_version: number }
        Returns: undefined
      }
      array_sin_duplicados: { Args: { a: unknown }; Returns: boolean }
      auditoria_texto: { Args: { campo: string; valor: Json }; Returns: string }
      auth_rol: { Args: never; Returns: Database["public"]["Enums"]["rol"] }
      corte_sin_precios: { Args: { c: Json }; Returns: Json }
      crear_cotizacion: {
        Args: {
          p_canal?: Database["public"]["Enums"]["canal_cotizacion"]
          p_chat_agente_id?: string
          p_cliente_documento?: string
          p_cliente_nombre: string
          p_cliente_telefono?: string
          p_lineas: Json
          p_monto_impuestos?: number
          p_monto_sin_impuestos?: number
          p_monto_total?: number
          p_notas?: string
          p_odoo_order_id?: number
          p_odoo_order_name?: string
          p_odoo_partner_id: number
        }
        Returns: string
      }
      crear_pedido: {
        Args: {
          p_abono_inicial?: number
          p_cantidad: number
          p_cotizacion_id?: string
          p_departamento_id?: number
          p_detalle?: string
          p_direccion_entrega?: string
          p_es_provincia: boolean
          p_fecha_prometida: string
          p_flete_pagado?: boolean
          p_indicaciones_lineas?: Json
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
      despachar_push: { Args: never; Returns: undefined }
      email_de_usuario: { Args: { nombre_usuario: string }; Returns: string }
      es_admin: { Args: never; Returns: boolean }
      escritura_del_sistema: { Args: never; Returns: boolean }
      etiqueta: { Args: { valor: string }; Returns: string }
      generar_codigo_pedido: { Args: { p_fecha?: string }; Returns: string }
      guardar_version_diseno_libre: {
        Args: {
          p_acomodo?: Json
          p_codigo: string
          p_color?: string
          p_diseno_id: string
          p_grupo_plancha_id?: string
          p_origen?: string
        }
        Returns: number
      }
      guardar_version_diseno: {
        Args: {
          p_acomodo?: Json
          p_color?: string
          p_diseno_id: string
          p_grupo_plancha_id?: string
          p_origen: string
          p_parametros: Json
          p_plantilla: string
          p_version_plantilla?: number
        }
        Returns: number
      }
      lineas_de_pedido: {
        Args: { p_codigo: string }
        Returns: {
          cantidad: number
          corte: Json
          descripcion: string
          diseno_id: string
          diseno_version: number
          diseno_version_id: string
          importe: number
          indicaciones: string
          materiales_usados: Json
          odoo_produccion_id: number
          odoo_produccion_nombre: string
          odoo_product_id: number
          planchas_usadas: number
          posicion: number
          precio_unitario: number
          produccion_cerrada: boolean
          producto_codigo: string
          producto_nombre: string
          terminado: Json
          tipo: Database["public"]["Enums"]["tipo_linea"]
        }[]
      }
      marcar_escritura_del_sistema: {
        Args: { activa: boolean }
        Returns: undefined
      }
      marcar_password_cambiada: { Args: never; Returns: undefined }
      odoo_de_pedido: {
        Args: { p_codigo: string }
        Returns: {
          anulada_en_odoo: boolean
          confirmada_en_odoo: boolean
          cotizacion_id: string
          error_anulacion: string
          error_stock: string
          odoo_order_id: number
          odoo_order_name: string
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado: boolean
        }[]
      }
      purgar_notificaciones: { Args: never; Returns: undefined }
      reservar_sobrantes_de_corte: {
        Args: {
          p_codigos: string[]
          p_corte: Json
          p_cotizacion: string
          p_posicion: number
        }
        Returns: undefined
      }
      retazo_minimo: { Args: never; Returns: number }
      soltar_sobrantes_de_pedido: {
        Args: { p_codigo: string; p_consumir: boolean; p_posicion?: number }
        Returns: number
      }
      terminado_sin_precios: { Args: { t: Json }; Returns: Json }
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
      canal_cotizacion: "tienda" | "whatsapp"
      estado_pedido:
        | "registrado"
        | "en_proceso"
        | "observado"
        | "listo"
        | "en_transito"
        | "entregado"
        | "anulado"
      estado_sobrante: "disponible" | "reservado" | "consumido" | "baja"
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
        | "anforas"
        | "alzadores"
        | "tarecos"
        | "atriles"
      pt_clase_opcion: "personalizacion" | "acabado" | "complemento"
      pt_geometria:
        | "caja_cerrada"
        | "caja_abierta"
        | "cilindro"
        | "lamina"
        | "lamina_plegada"
        | "letras"
        | "manual"
      rol: "administracion" | "logistica" | "operaciones"
      sincronizacion_odoo: "pendiente" | "sincronizada" | "error"
      tipo_adjunto: "diseno" | "factura" | "guia" | "foto_entrega"
      tipo_documento: "DNI" | "CE"
      tipo_linea: "producto" | "corte" | "terminado"
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
      canal_cotizacion: ["tienda", "whatsapp"],
      estado_pedido: [
        "registrado",
        "en_proceso",
        "observado",
        "listo",
        "en_transito",
        "entregado",
        "anulado",
      ],
      estado_sobrante: ["disponible", "reservado", "consumido", "baja"],
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
        "anforas",
        "alzadores",
        "tarecos",
        "atriles",
      ],
      pt_clase_opcion: ["personalizacion", "acabado", "complemento"],
      pt_geometria: [
        "caja_cerrada",
        "caja_abierta",
        "cilindro",
        "lamina",
        "lamina_plegada",
        "letras",
        "manual",
      ],
      rol: ["administracion", "logistica", "operaciones"],
      sincronizacion_odoo: ["pendiente", "sincronizada", "error"],
      tipo_adjunto: ["diseno", "factura", "guia", "foto_entrega"],
      tipo_documento: ["DNI", "CE"],
      tipo_linea: ["producto", "corte", "terminado"],
      tipo_notificacion: ["pedido_creado", "responsable_asignado"],
      tipo_pago: ["contado", "a_cuenta", "credito"],
      tipo_pedido: ["CL", "CM", "SP", "PT", "AC"],
      ubicacion: ["tienda", "taller", "agencia"],
    },
  },
} as const

