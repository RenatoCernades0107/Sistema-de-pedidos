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
      agente_documentos: {
        Row: {
          actualizado_en: string
          creado_en: string
          creado_por: string
          descripcion: string
          enviable: boolean
          error: string | null
          estado: string
          id: string
          mime: string
          nombre: string
          paginas: number | null
          ruta: string
          tamano: number
          tipo: string
        }
        Insert: {
          actualizado_en?: string
          creado_en?: string
          creado_por?: string
          descripcion?: string
          enviable?: boolean
          error?: string | null
          estado?: string
          id?: string
          mime: string
          nombre: string
          paginas?: number | null
          ruta: string
          tamano: number
          tipo: string
        }
        Update: {
          actualizado_en?: string
          creado_en?: string
          creado_por?: string
          descripcion?: string
          enviable?: boolean
          error?: string | null
          estado?: string
          id?: string
          mime?: string
          nombre?: string
          paginas?: number | null
          ruta?: string
          tamano?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "agente_documentos_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_fragmentos: {
        Row: {
          contenido: string
          documento_id: string
          embedding: string | null
          id: string
          modelo_embedding: string | null
          orden: number
          pagina: number | null
          tsv: unknown | null
        }
        Insert: {
          contenido: string
          documento_id: string
          embedding?: string | null
          id?: string
          modelo_embedding?: string | null
          orden: number
          pagina?: number | null
          tsv?: unknown | null
        }
        Update: {
          contenido?: string
          documento_id?: string
          embedding?: string | null
          id?: string
          modelo_embedding?: string | null
          orden?: number
          pagina?: number | null
          tsv?: unknown | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_fragmentos_documento_id_fkey"
            columns: ["documento_id"]
            isOneToOne: false
            referencedRelation: "agente_documentos"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_pruebas: {
        Row: {
          actualizado_en: string
          anuncio: Json | null
          creado_en: string
          creado_por: string
          id: string
          titulo: string
        }
        Insert: {
          actualizado_en?: string
          anuncio?: Json | null
          creado_en?: string
          creado_por?: string
          id?: string
          titulo?: string
        }
        Update: {
          actualizado_en?: string
          anuncio?: Json | null
          creado_en?: string
          creado_por?: string
          id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "agente_pruebas_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      agente_pruebas_mensajes: {
        Row: {
          adjuntos: Json | null
          contenido: string
          creado_en: string
          derivado: boolean
          id: string
          prueba_id: string
          rol: string
          traza: Json | null
        }
        Insert: {
          adjuntos?: Json | null
          contenido?: string
          creado_en?: string
          derivado?: boolean
          id?: string
          prueba_id: string
          rol: string
          traza?: Json | null
        }
        Update: {
          adjuntos?: Json | null
          contenido?: string
          creado_en?: string
          derivado?: boolean
          id?: string
          prueba_id?: string
          rol?: string
          traza?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agente_pruebas_mensajes_prueba_id_fkey"
            columns: ["prueba_id"]
            isOneToOne: false
            referencedRelation: "agente_pruebas"
            referencedColumns: ["id"]
          },
        ]
      }
      accesorios: {
        Row: {
          activo: boolean
          categoria_id: string
          codigo_odoo: string
          creado_en: string
          id: string
        }
        Insert: {
          activo?: boolean
          categoria_id: string
          codigo_odoo: string
          creado_en?: string
          id?: string
        }
        Update: {
          activo?: boolean
          categoria_id?: string
          codigo_odoo?: string
          creado_en?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accesorios_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_accesorio"
            referencedColumns: ["id"]
          },
        ]
      }
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
      almacenes: {
        Row: {
          activo: boolean
          codigo: string
          creado_en: string
          error_sincronizacion: string | null
          id: string
          nombre: string
          odoo_ubicacion_id: number | null
          odoo_warehouse_id: number | null
          orden: number
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          tipo: string
        }
        Insert: {
          activo?: boolean
          codigo: string
          creado_en?: string
          error_sincronizacion?: string | null
          id?: string
          nombre: string
          odoo_ubicacion_id?: number | null
          odoo_warehouse_id?: number | null
          orden?: number
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          tipo?: string
        }
        Update: {
          activo?: boolean
          codigo?: string
          creado_en?: string
          error_sincronizacion?: string | null
          id?: string
          nombre?: string
          odoo_ubicacion_id?: number | null
          odoo_warehouse_id?: number | null
          orden?: number
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          tipo?: string
        }
        Relationships: []
      }
      borradores: {
        Row: {
          actualizado_en: string
          cotizacion_id: string | null
          creado_en: string
          creado_por: string
          datos: Json
          id: string
          resumen: Json
          tipo: string
          vence_en: string
        }
        Insert: {
          actualizado_en?: string
          cotizacion_id?: string | null
          creado_en?: string
          creado_por?: string
          datos: Json
          id?: string
          resumen?: Json
          tipo: string
          vence_en?: string
        }
        Update: {
          actualizado_en?: string
          cotizacion_id?: string | null
          creado_en?: string
          creado_por?: string
          datos?: Json
          id?: string
          resumen?: Json
          tipo?: string
          vence_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "borradores_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "borradores_creado_por_fkey"
            columns: ["creado_por"]
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
          autor_nombre: string
          codigo: string | null
          color: string | null
          creado_en: string
          creado_por: string | null
          diseno_id: string
          estado: string
          grupo_plancha_id: string | null
          id: string
          materiales: Json | null
          miniatura_path: string | null
          nombre_version: string | null
          origen: string
          parametros: Json
          plantilla: string
          restaurada_de: number | null
          version: number
          version_plantilla: number | null
        }
        Insert: {
          acomodo?: Json | null
          aprobado_en?: string | null
          aprobado_por?: string | null
          autor_nombre?: string
          codigo?: string | null
          color?: string | null
          creado_en?: string
          creado_por?: string | null
          diseno_id: string
          estado?: string
          grupo_plancha_id?: string | null
          id?: string
          materiales?: Json | null
          miniatura_path?: string | null
          nombre_version?: string | null
          origen: string
          parametros?: Json
          plantilla: string
          restaurada_de?: number | null
          version: number
          version_plantilla?: number | null
        }
        Update: {
          acomodo?: Json | null
          aprobado_en?: string | null
          aprobado_por?: string | null
          autor_nombre?: string
          codigo?: string | null
          color?: string | null
          creado_en?: string
          creado_por?: string | null
          diseno_id?: string
          estado?: string
          grupo_plancha_id?: string | null
          id?: string
          materiales?: Json | null
          miniatura_path?: string | null
          nombre_version?: string | null
          origen?: string
          parametros?: Json
          plantilla?: string
          restaurada_de?: number | null
          version?: number
          version_plantilla?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cad_diseno_versiones_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
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
          {
            foreignKeyName: "cad_diseno_versiones_grupo_plancha_id_fkey"
            columns: ["grupo_plancha_id"]
            isOneToOne: false
            referencedRelation: "grupos_plancha"
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
          adjuntos: Json | null
          contenido: string
          creado_en: string
          diseno_id: string
          herramientas: Json | null
          id: string
          referencias: Json | null
          rol: string
        }
        Insert: {
          adjuntos?: Json | null
          contenido: string
          creado_en?: string
          diseno_id: string
          herramientas?: Json | null
          id?: string
          referencias?: Json | null
          rol: string
        }
        Update: {
          adjuntos?: Json | null
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
      cambios_precio: {
        Row: {
          codigo: string | null
          costo_base: number | null
          creado_en: string
          creado_por: string | null
          id: string
          margen_pct: number | null
          nombre: string
          precio_anterior: number | null
          precio_nuevo: number
          producto_odoo_id: number
        }
        Insert: {
          codigo?: string | null
          costo_base?: number | null
          creado_en?: string
          creado_por?: string | null
          id?: string
          margen_pct?: number | null
          nombre: string
          precio_anterior?: number | null
          precio_nuevo: number
          producto_odoo_id: number
        }
        Update: {
          codigo?: string | null
          costo_base?: number | null
          creado_en?: string
          creado_por?: string | null
          id?: string
          margen_pct?: number | null
          nombre?: string
          precio_anterior?: number | null
          precio_nuevo?: number
          producto_odoo_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cambios_precio_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      casos_stock: {
        Row: {
          almacen_id: string
          cantidad: number
          cerrado_en: string | null
          cerrado_por: string | null
          codigo: string
          codigo_producto: string | null
          contado: number | null
          conteo_id: string | null
          descripcion: string | null
          error_sincronizacion: string | null
          esperado: number | null
          estado: string
          id: string
          motivo: string | null
          nombre: string
          odoo_ref: number | null
          producto_odoo_id: number
          razon_cierre: string | null
          reportado_en: string
          reportado_por: string | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          sobrante_codigo: string | null
          tipo: string
        }
        Insert: {
          almacen_id: string
          cantidad: number
          cerrado_en?: string | null
          cerrado_por?: string | null
          codigo?: string
          codigo_producto?: string | null
          contado?: number | null
          conteo_id?: string | null
          descripcion?: string | null
          error_sincronizacion?: string | null
          esperado?: number | null
          estado?: string
          id?: string
          motivo?: string | null
          nombre: string
          odoo_ref?: number | null
          producto_odoo_id: number
          razon_cierre?: string | null
          reportado_en?: string
          reportado_por?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          sobrante_codigo?: string | null
          tipo: string
        }
        Update: {
          almacen_id?: string
          cantidad?: number
          cerrado_en?: string | null
          cerrado_por?: string | null
          codigo?: string
          codigo_producto?: string | null
          contado?: number | null
          conteo_id?: string | null
          descripcion?: string | null
          error_sincronizacion?: string | null
          esperado?: number | null
          estado?: string
          id?: string
          motivo?: string | null
          nombre?: string
          odoo_ref?: number | null
          producto_odoo_id?: number
          razon_cierre?: string | null
          reportado_en?: string
          reportado_por?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          sobrante_codigo?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "casos_stock_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "casos_stock_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "casos_stock_conteo_id_fkey"
            columns: ["conteo_id"]
            isOneToOne: false
            referencedRelation: "conteos_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "casos_stock_reportado_por_fkey"
            columns: ["reportado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "casos_stock_sobrante_codigo_fkey"
            columns: ["sobrante_codigo"]
            isOneToOne: false
            referencedRelation: "sobrantes"
            referencedColumns: ["codigo"]
          },
        ]
      }
      categorias_accesorio: {
        Row: {
          id: string
          nombre: string
          orden: number
          prefijo: string
        }
        Insert: {
          id?: string
          nombre: string
          orden?: number
          prefijo: string
        }
        Update: {
          id?: string
          nombre?: string
          orden?: number
          prefijo?: string
        }
        Relationships: []
      }
      compras: {
        Row: {
          actualizado_en: string
          almacen_id: string
          codigo: string
          condicion_pago: string
          confirmada_en: string | null
          creado_en: string
          creado_por: string | null
          dias_credito: number | null
          documento_proveedor: string | null
          error_sincronizacion: string | null
          estado: string
          fecha_embarque: string | null
          fecha_llegada_estimada: string | null
          id: string
          incoterm: string | null
          liquidada_en: string | null
          liquidada_por: string | null
          moneda_mercaderia: string
          nota: string | null
          odoo_orden_id: number | null
          odoo_orden_nombre: string | null
          proveedor_nombre: string
          proveedor_odoo_id: number
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"] | null
          tc_gastos: number | null
          tc_mercaderia: number | null
          tipo: string
        }
        Insert: {
          actualizado_en?: string
          almacen_id: string
          codigo?: string
          condicion_pago?: string
          confirmada_en?: string | null
          creado_en?: string
          creado_por?: string | null
          dias_credito?: number | null
          documento_proveedor?: string | null
          error_sincronizacion?: string | null
          estado?: string
          fecha_embarque?: string | null
          fecha_llegada_estimada?: string | null
          id?: string
          incoterm?: string | null
          liquidada_en?: string | null
          liquidada_por?: string | null
          moneda_mercaderia?: string
          nota?: string | null
          odoo_orden_id?: number | null
          odoo_orden_nombre?: string | null
          proveedor_nombre: string
          proveedor_odoo_id: number
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"] | null
          tc_gastos?: number | null
          tc_mercaderia?: number | null
          tipo: string
        }
        Update: {
          actualizado_en?: string
          almacen_id?: string
          codigo?: string
          condicion_pago?: string
          confirmada_en?: string | null
          creado_en?: string
          creado_por?: string | null
          dias_credito?: number | null
          documento_proveedor?: string | null
          error_sincronizacion?: string | null
          estado?: string
          fecha_embarque?: string | null
          fecha_llegada_estimada?: string | null
          id?: string
          incoterm?: string | null
          liquidada_en?: string | null
          liquidada_por?: string | null
          moneda_mercaderia?: string
          nota?: string | null
          odoo_orden_id?: number | null
          odoo_orden_nombre?: string | null
          proveedor_nombre?: string
          proveedor_odoo_id?: number
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"] | null
          tc_gastos?: number | null
          tc_mercaderia?: number | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_liquidada_por_fkey"
            columns: ["liquidada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_gastos: {
        Row: {
          compra_id: string
          concepto: string
          creado_en: string
          descripcion: string | null
          documento: string | null
          fecha_pago: string | null
          horas: number | null
          id: string
          moneda: string
          monto: number
          personas: number | null
          reparto: string
          tarifa: number | null
          tipo_mano_obra: string | null
        }
        Insert: {
          compra_id: string
          concepto: string
          creado_en?: string
          descripcion?: string | null
          documento?: string | null
          fecha_pago?: string | null
          horas?: number | null
          id?: string
          moneda: string
          monto: number
          personas?: number | null
          reparto: string
          tarifa?: number | null
          tipo_mano_obra?: string | null
        }
        Update: {
          compra_id?: string
          concepto?: string
          creado_en?: string
          descripcion?: string | null
          documento?: string | null
          fecha_pago?: string | null
          horas?: number | null
          id?: string
          moneda?: string
          monto?: number
          personas?: number | null
          reparto?: string
          tarifa?: number | null
          tipo_mano_obra?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_gastos_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_lineas: {
        Row: {
          cantidad: number
          cantidad_recibida: number
          codigo: string | null
          compra_id: string
          kilos: number | null
          nombre: string
          posicion: number
          precio_unitario: number
          producto_odoo_id: number
          total_proveedor: number | null
        }
        Insert: {
          cantidad: number
          cantidad_recibida?: number
          codigo?: string | null
          compra_id: string
          kilos?: number | null
          nombre: string
          posicion: number
          precio_unitario: number
          producto_odoo_id: number
          total_proveedor?: number | null
        }
        Update: {
          cantidad?: number
          cantidad_recibida?: number
          codigo?: string | null
          compra_id?: string
          kilos?: number | null
          nombre?: string
          posicion?: number
          precio_unitario?: number
          producto_odoo_id?: number
          total_proveedor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "compras_lineas_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_recepciones: {
        Row: {
          compra_id: string
          creado_en: string
          creado_por: string | null
          error_sincronizacion: string | null
          id: string
          nota: string | null
          odoo_picking_id: number | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
        }
        Insert: {
          compra_id: string
          creado_en?: string
          creado_por?: string | null
          error_sincronizacion?: string | null
          id?: string
          nota?: string | null
          odoo_picking_id?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
        }
        Update: {
          compra_id?: string
          creado_en?: string
          creado_por?: string | null
          error_sincronizacion?: string | null
          id?: string
          nota?: string | null
          odoo_picking_id?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
        }
        Relationships: [
          {
            foreignKeyName: "compras_recepciones_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compras_recepciones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      compras_recepciones_lineas: {
        Row: {
          cantidad: number
          posicion: number
          recepcion_id: string
        }
        Insert: {
          cantidad: number
          posicion: number
          recepcion_id: string
        }
        Update: {
          cantidad?: number
          posicion?: number
          recepcion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_recepciones_lineas_recepcion_id_fkey"
            columns: ["recepcion_id"]
            isOneToOne: false
            referencedRelation: "compras_recepciones"
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
      conteos_stock: {
        Row: {
          alcance: string
          almacen_id: string
          codigo: string
          coincidencias: number | null
          creado_en: string
          creado_por: string | null
          diferencias: number | null
          enviado_en: string | null
          enviado_por: string | null
          estado: string
          id: string
        }
        Insert: {
          alcance: string
          almacen_id: string
          codigo?: string
          coincidencias?: number | null
          creado_en?: string
          creado_por?: string | null
          diferencias?: number | null
          enviado_en?: string | null
          enviado_por?: string | null
          estado?: string
          id?: string
        }
        Update: {
          alcance?: string
          almacen_id?: string
          codigo?: string
          coincidencias?: number | null
          creado_en?: string
          creado_por?: string | null
          diferencias?: number | null
          enviado_en?: string | null
          enviado_por?: string | null
          estado?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conteos_stock_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_stock_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_stock_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      conteos_stock_lineas: {
        Row: {
          codigo: string | null
          contado: number | null
          conteo_id: string
          grupo: string | null
          nombre: string
          producto_odoo_id: number
        }
        Insert: {
          codigo?: string | null
          contado?: number | null
          conteo_id: string
          grupo?: string | null
          nombre: string
          producto_odoo_id: number
        }
        Update: {
          codigo?: string | null
          contado?: number | null
          conteo_id?: string
          grupo?: string | null
          nombre?: string
          producto_odoo_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "conteos_stock_lineas_conteo_id_fkey"
            columns: ["conteo_id"]
            isOneToOne: false
            referencedRelation: "conteos_stock"
            referencedColumns: ["id"]
          },
        ]
      }
      conteos_stock_sobrantes: {
        Row: {
          conteo_id: string
          encontrado: boolean | null
          sobrante_codigo: string
        }
        Insert: {
          conteo_id: string
          encontrado?: boolean | null
          sobrante_codigo: string
        }
        Update: {
          conteo_id?: string
          encontrado?: boolean | null
          sobrante_codigo?: string
        }
        Relationships: [
          {
            foreignKeyName: "conteos_stock_sobrantes_conteo_id_fkey"
            columns: ["conteo_id"]
            isOneToOne: false
            referencedRelation: "conteos_stock"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_stock_sobrantes_sobrante_codigo_fkey"
            columns: ["sobrante_codigo"]
            isOneToOne: false
            referencedRelation: "sobrantes"
            referencedColumns: ["codigo"]
          },
        ]
      }
      conversacion_miembros: {
        Row: {
          agregado_en: string
          agregado_por: string | null
          conversacion_id: string
          usuario_id: string
        }
        Insert: {
          agregado_en?: string
          agregado_por?: string | null
          conversacion_id: string
          usuario_id: string
        }
        Update: {
          agregado_en?: string
          agregado_por?: string | null
          conversacion_id?: string
          usuario_id?: string
        }
        Relationships: []
      }
      conversaciones: {
        Row: {
          creado_en: string
          creado_por: string | null
          descripcion: string | null
          directo_clave: string | null
          id: string
          nombre: string | null
          pedido_id: string | null
          tipo: Database["public"]["Enums"]["tipo_conversacion"]
          ultimo_mensaje_en: string | null
        }
        Insert: {
          creado_en?: string
          creado_por?: string | null
          descripcion?: string | null
          directo_clave?: string | null
          id?: string
          nombre?: string | null
          pedido_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_conversacion"]
          ultimo_mensaje_en?: string | null
        }
        Update: {
          creado_en?: string
          creado_por?: string | null
          descripcion?: string | null
          directo_clave?: string | null
          id?: string
          nombre?: string | null
          pedido_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_conversacion"]
          ultimo_mensaje_en?: string | null
        }
        Relationships: []
      }
      costos_historial: {
        Row: {
          cantidad: number
          codigo: string | null
          compra_id: string | null
          costo_kg_pen: number | null
          costo_unitario_pen: number
          costo_unitario_usd: number | null
          creado_en: string
          desglose: Json
          fecha: string
          id: string
          ingreso_id: string | null
          nombre: string
          origen: string
          producto_odoo_id: number
        }
        Insert: {
          cantidad: number
          codigo?: string | null
          compra_id?: string | null
          costo_kg_pen?: number | null
          costo_unitario_pen: number
          costo_unitario_usd?: number | null
          creado_en?: string
          desglose?: Json
          fecha: string
          id?: string
          ingreso_id?: string | null
          nombre: string
          origen: string
          producto_odoo_id: number
        }
        Update: {
          cantidad?: number
          codigo?: string | null
          compra_id?: string | null
          costo_kg_pen?: number | null
          costo_unitario_pen?: number
          costo_unitario_usd?: number | null
          creado_en?: string
          desglose?: Json
          fecha?: string
          id?: string
          ingreso_id?: string | null
          nombre?: string
          origen?: string
          producto_odoo_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "costos_historial_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "costos_historial_ingreso_id_fkey"
            columns: ["ingreso_id"]
            isOneToOne: false
            referencedRelation: "ingresos_stock"
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
          planchas_usadas_formato: Json | null
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
          planchas_usadas_formato?: Json | null
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
          planchas_usadas_formato?: Json | null
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
          {
            foreignKeyName: "cotizacion_productos_diseno_version_id_fkey"
            columns: ["diseno_version_id"]
            isOneToOne: false
            referencedRelation: "cad_diseno_versiones"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          actualizado_en: string
          almacen_despacho_id: string | null
          anulada_en_odoo: boolean
          canal: Database["public"]["Enums"]["canal_cotizacion"]
          chat_agente_id: string | null
          cliente_documento: string | null
          cliente_nombre: string
          cliente_telefono: string | null
          contacto_nombre: string | null
          confirmada_en_odoo: boolean
          creado_en: string
          creado_por: string | null
          error_anulacion: string | null
          error_confirmacion: string | null
          error_sincronizacion: string | null
          error_edicion: string | null
          error_stock: string | null
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          enviada_en: string | null
          id: string
          monto_impuestos: number | null
          monto_sin_impuestos: number | null
          monto_total: number | null
          notas: string | null
          odoo_contacto_id: number | null
          odoo_order_id: number | null
          odoo_order_name: string | null
          odoo_partner_id: number
          pedido_id: string | null
          reemplaza_a: string | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado: boolean
          token_publico: string
          version: number
        }
        Insert: {
          actualizado_en?: string
          almacen_despacho_id?: string | null
          anulada_en_odoo?: boolean
          canal?: Database["public"]["Enums"]["canal_cotizacion"]
          chat_agente_id?: string | null
          cliente_documento?: string | null
          cliente_nombre: string
          cliente_telefono?: string | null
          contacto_nombre?: string | null
          confirmada_en_odoo?: boolean
          creado_en?: string
          creado_por?: string | null
          error_anulacion?: string | null
          error_confirmacion?: string | null
          error_sincronizacion?: string | null
          error_edicion?: string | null
          error_stock?: string | null
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          enviada_en?: string | null
          id?: string
          monto_impuestos?: number | null
          monto_sin_impuestos?: number | null
          monto_total?: number | null
          notas?: string | null
          odoo_contacto_id?: number | null
          odoo_order_id?: number | null
          odoo_order_name?: string | null
          odoo_partner_id: number
          pedido_id?: string | null
          reemplaza_a?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado?: boolean
          token_publico?: string
          version?: number
        }
        Update: {
          actualizado_en?: string
          almacen_despacho_id?: string | null
          anulada_en_odoo?: boolean
          canal?: Database["public"]["Enums"]["canal_cotizacion"]
          chat_agente_id?: string | null
          cliente_documento?: string | null
          cliente_nombre?: string
          cliente_telefono?: string | null
          contacto_nombre?: string | null
          confirmada_en_odoo?: boolean
          creado_en?: string
          creado_por?: string | null
          error_anulacion?: string | null
          error_confirmacion?: string | null
          error_sincronizacion?: string | null
          error_edicion?: string | null
          error_stock?: string | null
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          enviada_en?: string | null
          id?: string
          monto_impuestos?: number | null
          monto_sin_impuestos?: number | null
          monto_total?: number | null
          notas?: string | null
          odoo_contacto_id?: number | null
          odoo_order_id?: number | null
          odoo_order_name?: string | null
          odoo_partner_id?: number
          pedido_id?: string | null
          reemplaza_a?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          stock_descontado?: boolean
          token_publico?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_almacen_despacho_id_fkey"
            columns: ["almacen_despacho_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_reemplaza_a_fkey"
            columns: ["reemplaza_a"]
            isOneToOne: true
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
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
      cuentas_bancarias: {
        Row: {
          banco: string
          cci: string | null
          creada_en: string
          creada_por: string
          en_pdf: boolean
          id: string
          moneda: string
          numero: string
          retirada_en: string | null
          retirada_por: string | null
          tipo: string
          vigente_desde: string
        }
        Insert: {
          banco: string
          cci?: string | null
          creada_en?: string
          creada_por: string
          en_pdf?: boolean
          id?: string
          moneda: string
          numero: string
          retirada_en?: string | null
          retirada_por?: string | null
          tipo: string
          vigente_desde: string
        }
        Update: {
          banco?: string
          cci?: string | null
          creada_en?: string
          creada_por?: string
          en_pdf?: boolean
          id?: string
          moneda?: string
          numero?: string
          retirada_en?: string | null
          retirada_por?: string | null
          tipo?: string
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_bancarias_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cuentas_bancarias_retirada_por_fkey"
            columns: ["retirada_por"]
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
      faltantes_stock: {
        Row: {
          almacen_id: string
          cantidad: number
          codigo: string | null
          creado_en: string
          estado: string
          id: string
          motivo: string
          nombre: string
          origen_sugerido_id: string | null
          pedido_id: string
          producto_odoo_id: number
          resuelto_en: string | null
          transferencia_id: string | null
        }
        Insert: {
          almacen_id: string
          cantidad: number
          codigo?: string | null
          creado_en?: string
          estado?: string
          id?: string
          motivo: string
          nombre: string
          origen_sugerido_id?: string | null
          pedido_id: string
          producto_odoo_id: number
          resuelto_en?: string | null
          transferencia_id?: string | null
        }
        Update: {
          almacen_id?: string
          cantidad?: number
          codigo?: string | null
          creado_en?: string
          estado?: string
          id?: string
          motivo?: string
          nombre?: string
          origen_sugerido_id?: string | null
          pedido_id?: string
          producto_odoo_id?: number
          resuelto_en?: string | null
          transferencia_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faltantes_stock_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faltantes_stock_origen_sugerido_id_fkey"
            columns: ["origen_sugerido_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faltantes_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faltantes_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faltantes_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faltantes_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faltantes_stock_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "transferencias_stock"
            referencedColumns: ["id"]
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
      ingresos_stock: {
        Row: {
          almacen_id: string
          codigo: string
          creado_en: string
          creado_por: string | null
          documento: string | null
          error_sincronizacion: string | null
          id: string
          nota: string | null
          odoo_picking_id: number | null
          proveedor_nombre: string | null
          proveedor_odoo_id: number | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          tipo: string
        }
        Insert: {
          almacen_id: string
          codigo?: string
          creado_en?: string
          creado_por?: string | null
          documento?: string | null
          error_sincronizacion?: string | null
          id?: string
          nota?: string | null
          odoo_picking_id?: number | null
          proveedor_nombre?: string | null
          proveedor_odoo_id?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          tipo: string
        }
        Update: {
          almacen_id?: string
          codigo?: string
          creado_en?: string
          creado_por?: string | null
          documento?: string | null
          error_sincronizacion?: string | null
          id?: string
          nota?: string | null
          odoo_picking_id?: number | null
          proveedor_nombre?: string | null
          proveedor_odoo_id?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingresos_stock_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingresos_stock_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ingresos_stock_lineas: {
        Row: {
          cantidad: number
          cantidad_anterior: number | null
          codigo: string | null
          costo_unitario: number | null
          ingreso_id: string
          nombre: string
          posicion: number
          producto_odoo_id: number
        }
        Insert: {
          cantidad: number
          cantidad_anterior?: number | null
          codigo?: string | null
          costo_unitario?: number | null
          ingreso_id: string
          nombre: string
          posicion: number
          producto_odoo_id: number
        }
        Update: {
          cantidad?: number
          cantidad_anterior?: number | null
          codigo?: string | null
          costo_unitario?: number | null
          ingreso_id?: string
          nombre?: string
          posicion?: number
          producto_odoo_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingresos_stock_lineas_ingreso_id_fkey"
            columns: ["ingreso_id"]
            isOneToOne: false
            referencedRelation: "ingresos_stock"
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
      margenes_plancha: {
        Row: {
          actualizado_en: string
          actualizado_por: string | null
          codigo_odoo: string
          margen_pct: number
        }
        Insert: {
          actualizado_en?: string
          actualizado_por?: string | null
          codigo_odoo: string
          margen_pct: number
        }
        Update: {
          actualizado_en?: string
          actualizado_por?: string | null
          codigo_odoo?: string
          margen_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "margenes_plancha_actualizado_por_fkey"
            columns: ["actualizado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      mensaje_adjuntos: {
        Row: {
          alto: number | null
          ancho: number | null
          conversacion_id: string
          creado_en: string
          duracion_s: number | null
          id: string
          mensaje_id: string
          mime: string
          nombre: string
          posicion: number
          storage_path: string
          tamano: number
        }
        Insert: {
          alto?: number | null
          ancho?: number | null
          conversacion_id: string
          creado_en?: string
          duracion_s?: number | null
          id?: string
          mensaje_id: string
          mime: string
          nombre: string
          posicion?: number
          storage_path: string
          tamano: number
        }
        Update: {
          alto?: number | null
          ancho?: number | null
          conversacion_id?: string
          creado_en?: string
          duracion_s?: number | null
          id?: string
          mensaje_id?: string
          mime?: string
          nombre?: string
          posicion?: number
          storage_path?: string
          tamano?: number
        }
        Relationships: []
      }
      mensaje_lecturas: {
        Row: {
          conversacion_id: string
          leido_en: string
          mensaje_id: string
          usuario_id: string
        }
        Insert: {
          conversacion_id: string
          leido_en?: string
          mensaje_id: string
          usuario_id: string
        }
        Update: {
          conversacion_id?: string
          leido_en?: string
          mensaje_id?: string
          usuario_id?: string
        }
        Relationships: []
      }
      mensajes: {
        Row: {
          autor_id: string
          autor_nombre: string
          autor_rol: Database["public"]["Enums"]["rol"] | null
          conversacion_id: string
          creado_en: string
          id: string
          referencias: Json
          texto: string
        }
        Insert: {
          autor_id?: string
          autor_nombre?: string
          autor_rol?: Database["public"]["Enums"]["rol"] | null
          conversacion_id: string
          creado_en?: string
          id?: string
          referencias?: Json
          texto?: string
        }
        Update: {
          autor_id?: string
          autor_nombre?: string
          autor_rol?: Database["public"]["Enums"]["rol"] | null
          conversacion_id?: string
          creado_en?: string
          id?: string
          referencias?: Json
          texto?: string
        }
        Relationships: []
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
          notas_entrega: string | null
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
          token_seguimiento: string
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
          notas_entrega?: string | null
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
          token_seguimiento?: string
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
          notas_entrega?: string | null
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
          token_seguimiento?: string
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
          miniatura_path: string | null
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
          miniatura_path?: string | null
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
          miniatura_path?: string | null
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
          almacen_id: string
          ancho_cm: number
          codigo: string
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
          precio_venta: number | null
          reserva_pedido_id: string | null
          reserva_posicion: number | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
          ubicacion: string | null
        }
        Insert: {
          actualizado_en?: string
          almacen_id: string
          ancho_cm: number
          codigo?: string
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
          precio_venta?: number | null
          reserva_pedido_id?: string | null
          reserva_posicion?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          ubicacion?: string | null
        }
        Update: {
          actualizado_en?: string
          almacen_id?: string
          ancho_cm?: number
          codigo?: string
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
          precio_venta?: number | null
          reserva_pedido_id?: string | null
          reserva_posicion?: number | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
          ubicacion?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sobrantes_almacen_id_fkey"
            columns: ["almacen_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
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
      transferencias_stock: {
        Row: {
          codigo: string
          desde_id: string
          enviado_en: string
          enviado_por: string | null
          error_sincronizacion: string | null
          estado: string
          hacia_id: string
          id: string
          nota: string | null
          odoo_envio_id: number | null
          odoo_recepcion_id: number | null
          pedido_id: string | null
          recibido_en: string | null
          recibido_por: string | null
          sincronizacion: Database["public"]["Enums"]["sincronizacion_odoo"]
        }
        Insert: {
          codigo?: string
          desde_id: string
          enviado_en?: string
          enviado_por?: string | null
          error_sincronizacion?: string | null
          estado?: string
          hacia_id: string
          id?: string
          nota?: string | null
          odoo_envio_id?: number | null
          odoo_recepcion_id?: number | null
          pedido_id?: string | null
          recibido_en?: string | null
          recibido_por?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
        }
        Update: {
          codigo?: string
          desde_id?: string
          enviado_en?: string
          enviado_por?: string | null
          error_sincronizacion?: string | null
          estado?: string
          hacia_id?: string
          id?: string
          nota?: string | null
          odoo_envio_id?: number | null
          odoo_recepcion_id?: number | null
          pedido_id?: string | null
          recibido_en?: string | null
          recibido_por?: string | null
          sincronizacion?: Database["public"]["Enums"]["sincronizacion_odoo"]
        }
        Relationships: [
          {
            foreignKeyName: "transferencias_stock_desde_id_fkey"
            columns: ["desde_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_hacia_id_fkey"
            columns: ["hacia_id"]
            isOneToOne: false
            referencedRelation: "almacenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_logistica"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_stock_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      transferencias_stock_lineas: {
        Row: {
          cantidad: number
          codigo: string | null
          nombre: string
          posicion: number
          producto_odoo_id: number
          sobrante_codigo: string | null
          transferencia_id: string
        }
        Insert: {
          cantidad: number
          codigo?: string | null
          nombre: string
          posicion: number
          producto_odoo_id: number
          sobrante_codigo?: string | null
          transferencia_id: string
        }
        Update: {
          cantidad?: number
          codigo?: string | null
          nombre?: string
          posicion?: number
          producto_odoo_id?: number
          sobrante_codigo?: string | null
          transferencia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencias_stock_lineas_sobrante_codigo_fkey"
            columns: ["sobrante_codigo"]
            isOneToOne: false
            referencedRelation: "sobrantes"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "transferencias_stock_lineas_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "transferencias_stock"
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
          email_recuperacion: string | null
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
          email_recuperacion?: string | null
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
          email_recuperacion?: string | null
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
          notas_entrega: string | null
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
          notas_entrega: string | null
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
          notas_entrega: string | null
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
      pedidos_ventas: {
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
          notas_entrega: string | null
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
      buscar_fragmentos_agente: {
        Args: {
          p_embedding?: string | null
          p_limite?: number
          p_modelo?: string | null
          p_texto: string
        }
        Returns: {
          contenido: string
          documento_id: string
          documento_nombre: string
          documento_enviable: boolean
          documento_tipo: string
          fragmento_id: string
          pagina: number | null
          puntaje: number
        }[]
      }
      abrir_directo: {
        Args: { p_usuario_id: string }
        Returns: string
      }
      agregar_cuenta_bancaria: {
        Args: {
          clave: string
          p_banco: string
          p_cci: string
          p_moneda: string
          p_numero: string
          p_tipo: string
        }
        Returns: string
      }
      agregar_miembros: {
        Args: { p_conversacion_id: string; p_usuarios: string[] }
        Returns: number
      }
      anotar_anulacion_en_odoo: {
        Args: { p_anulada: boolean; p_codigo: string; p_error?: string }
        Returns: undefined
      }
      anotar_materiales_de_terminado: {
        Args: { p_codigo: string; p_materiales: Json; p_posicion: number }
        Returns: undefined
      }
      anotar_planchas_usadas: {
        Args: {
          p_codigo: string
          p_planchas: number
          p_por_formato?: Json
          p_posicion: number
        }
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
      anular_transferencia: { Args: { p_id: string }; Returns: undefined }
      aprobar_version_diseno: {
        Args: { p_diseno_id: string; p_version: number }
        Returns: undefined
      }
      array_sin_duplicados: { Args: { a: unknown }; Returns: boolean }
      auditoria_texto: { Args: { campo: string; valor: Json }; Returns: string }
      auth_rol: { Args: never; Returns: Database["public"]["Enums"]["rol"] }
      avisar_casos: { Args: { p_codigos: string[] }; Returns: number }
      avisar_faltantes: { Args: { p_pedido: string }; Returns: number }
      cerrar_caso: {
        Args: {
          p_decision: string
          p_id: string
          p_odoo_ref?: number
          p_razon: string
        }
        Returns: undefined
      }
      config_tarifas_mano_obra: { Args: never; Returns: Json }
      gestiona_compras: { Args: never; Returns: boolean }
      config_almacen: { Args: never; Returns: Json }
      config_lista_precios: { Args: never; Returns: Json }
      conteo_abierto: { Args: { p_conteo: string }; Returns: boolean }
      buscar_pedidos_chat: {
        Args: { p_q: string }
        Returns: {
          codigo: string
          estado: Database["public"]["Enums"]["estado_pedido"]
          fecha_creacion: string
          fecha_prometida: string
          nombre_cliente: string
        }[]
      }
      chat_compactar: { Args: { p_texto: string }; Returns: string }
      chat_normalizar: { Args: { p_texto: string }; Returns: string }
      chat_telefono: { Args: { p_texto: string }; Returns: string }
      clientes_de_pedidos: {
        Args: { p_q: string }
        Returns: {
          nombre: string
          pedidos: number
          telefono: string
          ultimo: string
        }[]
      }
      cliente_de_pedido: {
        Args: { p_codigo: string }
        Returns: {
          documento: string
        }[]
      }
      conversacion_de_pedido: {
        Args: { p_pedido_id: string }
        Returns: string
      }
      corte_sin_precios: { Args: { c: Json }; Returns: Json }
      actualizar_cotizacion: {
        Args: {
          p_canal?: Database["public"]["Enums"]["canal_cotizacion"]
          p_cliente_documento?: string
          p_cliente_nombre: string
          p_cliente_telefono?: string
          p_contacto_nombre?: string
          p_id: string
          p_lineas: Json
          p_notas?: string
          p_odoo_contacto_id?: number
          p_odoo_partner_id: number
        }
        Returns: undefined
      }
      cotizacion_publica: { Args: { p_token: string }; Returns: Json }
      nueva_version_cotizacion: { Args: { p_id: string }; Returns: string }
      crear_canal: {
        Args: { p_descripcion: string | null; p_miembros: string[]; p_nombre: string }
        Returns: string
      }
      crear_cotizacion: {
        Args: {
          p_canal?: Database["public"]["Enums"]["canal_cotizacion"]
          p_chat_agente_id?: string
          p_cliente_documento?: string
          p_cliente_nombre: string
          p_cliente_telefono?: string
          p_contacto_nombre?: string
          p_lineas: Json
          p_monto_impuestos?: number
          p_monto_sin_impuestos?: number
          p_monto_total?: number
          p_notas?: string
          p_odoo_contacto_id?: number
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
          p_notas_entrega?: string
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
      enviar_conteo: {
        Args: { p_coincidencias: number; p_diferencias: number; p_id: string }
        Returns: undefined
      }
      enviar_sobrantes: {
        Args: { p_transferencia: string }
        Returns: undefined
      }
      cerrar_sesiones_de: { Args: { p_usuario_id: string }; Returns: undefined }
      clave_de_login_valida: { Args: { clave: string }; Returns: boolean }
      directorio_usuarios: {
        Args: never
        Returns: {
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["rol"]
          usuario: string
        }[]
      }
      editar_canal: {
        Args: { p_conversacion_id: string; p_descripcion: string | null; p_nombre: string }
        Returns: undefined
      }
      eliminar_canal: {
        Args: { p_conversacion_id: string }
        Returns: undefined
      }
      email_de_usuario: { Args: { clave: string; nombre_usuario: string }; Returns: string }
      enviar_mensaje: {
        Args: {
          p_adjuntos?: Json
          p_conversacion_id: string
          p_referencias?: Json
          p_texto: string
        }
        Returns: string
      }
      es_admin: { Args: never; Returns: boolean }
      escritura_del_sistema: { Args: never; Returns: boolean }
      etiqueta: { Args: { valor: string }; Returns: string }
      fijar_precio_sobrante: {
        Args: { p_codigo: string; p_precio: number }
        Returns: undefined
      }
      generar_codigo_pedido: { Args: { p_fecha?: string }; Returns: string }
      gestiona_stock: { Args: never; Returns: boolean }
      guardar_version_diseno: {
        Args: {
          p_acomodo?: Json
          p_color?: string
          p_diseno_id: string
          p_grupo_plancha_id?: string
          p_materiales?: Json
          p_origen: string
          p_parametros: Json
          p_plantilla: string
          p_version_plantilla?: number
        }
        Returns: number
      }
      guardar_version_diseno_libre: {
        Args: {
          p_acomodo?: Json
          p_codigo: string
          p_color?: string
          p_diseno_id: string
          p_grupo_plancha_id?: string
          p_materiales?: Json
          p_origen?: string
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
          planchas_usadas_formato: Json
          posicion: number
          precio_unitario: number
          produccion_cerrada: boolean
          producto_codigo: string
          producto_nombre: string
          terminado: Json
          tipo: Database["public"]["Enums"]["tipo_linea"]
        }[]
      }
      lineas_de_pedidos: {
        Args: { p_ids: string[] }
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
          pedido_id: string
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
      marcar_leidos: {
        Args: { p_conversacion_id: string; p_hasta?: string }
        Returns: number
      }
      limpiar_intentos_login: { Args: { clave: string; nombre_usuario: string }; Returns: undefined }
      login_bloqueado: {
        Args: { clave: string; direccion_ip: string; nombre_usuario: string }
        Returns: boolean
      }
      marcar_password_cambiada: { Args: never; Returns: undefined }
      nombrar_version_diseno: {
        Args: { p_diseno_id: string; p_nombre: string; p_version: number }
        Returns: undefined
      }
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
      participantes_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: {
          desde: string
          nombre: string
          rol: Database["public"]["Enums"]["rol"]
          usuario_id: string
        }[]
      }
      pedidos_de_cliente: {
        Args: { p_nombre: string | null; p_partner_id: number | null; p_telefono: string | null }
        Returns: {
          codigo: string
          estado: Database["public"]["Enums"]["estado_pedido"]
          fecha_creacion: string
          fecha_prometida: string
          nombre_cliente: string
        }[]
      }
      puede_ver_conversacion: {
        Args: { p_conversacion_id: string }
        Returns: boolean
      }
      purgar_borradores: { Args: never; Returns: undefined }
      purgar_notificaciones: { Args: never; Returns: undefined }
      quitar_miembro: {
        Args: { p_conversacion_id: string; p_usuario_id: string }
        Returns: undefined
      }
      recibir_transferencia: {
        Args: { p_id: string; p_odoo_recepcion_id: number }
        Returns: undefined
      }
      reservar_sobrantes_de_corte: {
        Args: {
          p_codigos: string[]
          p_corte: Json
          p_cotizacion: string
          p_posicion: number
        }
        Returns: undefined
      }
      reservar_sobrantes_de_terminado: {
        Args: {
          p_codigos: string[]
          p_cotizacion: string
          p_posicion: number
          p_terminado: Json
        }
        Returns: undefined
      }
      restaurar_version_diseno: {
        Args: { p_diseno_id: string; p_version: number }
        Returns: number
      }
      retirar_cuenta_bancaria: {
        Args: { clave: string; p_id: string }
        Returns: undefined
      }
      mostrar_cuenta_en_pdf: {
        Args: { p_id: string; p_mostrar: boolean }
        Returns: undefined
      }
      resumen_conversaciones: {
        Args: never
        Returns: {
          descripcion: string | null
          id: string
          menciones_sin_leer: number
          miembros: number
          nombre: string | null
          otro_usuario_id: string | null
          otro_usuario_rol: Database["public"]["Enums"]["rol"] | null
          pedido_codigo: string | null
          pedido_id: string | null
          sin_leer: number
          tipo: Database["public"]["Enums"]["tipo_conversacion"]
          ultimo_adjuntos: number
          ultimo_autor: string | null
          ultimo_autor_id: string | null
          ultimo_mensaje_en: string | null
          ultimo_texto: string | null
        }[]
      }
      retazo_minimo: { Args: never; Returns: number }
      seguimiento_pedido: { Args: { p_token: string }; Returns: Json }
      soltar_sobrantes_de_pedido: {
        Args: { p_codigo: string; p_consumir: boolean; p_posicion?: number }
        Returns: number
      }
      registrar_intento_fallido: {
        Args: { clave: string; direccion_ip: string; nombre_usuario: string }
        Returns: undefined
      }
      terminado_sin_precios: { Args: { t: Json }; Returns: Json }
      tiene_correo_recuperacion: { Args: { clave: string; nombre_usuario: string }; Returns: boolean }
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
      token_seguimiento: { Args: { p_codigo: string }; Returns: string }
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
      estado_cotizacion: "borrador" | "enviada" | "reemplazada"
      estado_pedido:
        | "registrado"
        | "en_proceso"
        | "observado"
        | "listo"
        | "en_transito"
        | "entregado"
        | "anulado"
      estado_sobrante:
        | "disponible"
        | "reservado"
        | "consumido"
        | "baja"
        | "en_transito"
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
      rol: "administracion" | "logistica" | "operaciones" | "ventas"
      sincronizacion_odoo: "pendiente" | "sincronizada" | "error"
      tipo_adjunto: "diseno" | "factura" | "guia" | "foto_entrega"
      tipo_documento: "DNI" | "CE"
      tipo_linea: "producto" | "corte" | "terminado"
      tipo_conversacion: "general" | "canal" | "directo" | "pedido"
      tipo_notificacion:
        | "pedido_creado"
        | "responsable_asignado"
        | "mencion"
        | "mensaje_directo"
        | "diseno_modificado"
        | "mover_stock"
        | "caso_stock"
        | "cuenta_bancaria"
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
      estado_cotizacion: ["borrador", "enviada", "reemplazada"],
      estado_pedido: [
        "registrado",
        "en_proceso",
        "observado",
        "listo",
        "en_transito",
        "entregado",
        "anulado",
      ],
      estado_sobrante: [
        "disponible",
        "reservado",
        "consumido",
        "baja",
        "en_transito",
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
      rol: ["administracion", "logistica", "operaciones", "ventas"],
      sincronizacion_odoo: ["pendiente", "sincronizada", "error"],
      tipo_adjunto: ["diseno", "factura", "guia", "foto_entrega"],
      tipo_documento: ["DNI", "CE"],
      tipo_linea: ["producto", "corte", "terminado"],
      tipo_conversacion: ["general", "canal", "directo", "pedido"],
      tipo_notificacion: [
        "pedido_creado",
        "responsable_asignado",
        "mencion",
        "mensaje_directo",
        "diseno_modificado",
        "mover_stock",
        "caso_stock",
        "cuenta_bancaria",
      ],
      tipo_pago: ["contado", "a_cuenta", "credito"],
      tipo_pedido: ["CL", "CM", "SP", "PT", "AC"],
      ubicacion: ["tienda", "taller", "agencia"],
    },
  },
} as const

