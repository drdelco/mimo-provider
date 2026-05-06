# 🤖 BRIEFING: AI Orchestra - Multi-Provider Coding Agent

**Fecha:** 2026-05-06  
**Branch:** `feature/multi-provider-orchestra`  
**Commit:** `81637f5`  
**Estado:** Fase 1 completa - Listo para Fase 2

---

## 📋 CONTEXTO DEL PROYECTO

**Repositorio:** `github.com/drdelco/mimo-provider`  
**Proyecto original:** Extensión VS Code/Antigravity para MiMo (Xiaomi)  
**Objetivo:** Transformarla en sistema multi-agente con orquestación automática

**Stack:**
- TypeScript + VS Code Extension API
- Proveedores: MiMo (Token Plan), Kimi (Moonshot), DeepSeek, Claude (Anthropic)
- Arquitectura: Provider pattern + Director pattern

---

## ✅ LO QUE YA ESTÁ IMPLEMENTADO (Fase 1)

### 1. Arquitectura Base
- **`src/providers/BaseProvider.ts`**
  - Interfaz `AICodingProvider` con métodos: `isAvailable()`, `chat()`, `estimateCost()`, `countTokens()`
  - `ProviderFactory` para registrar/gestionar providers
  - Modelos de datos: `AIModel`, `ChatMessage`, `ChatChunk`, `ToolDefinition`

### 2. Providers Implementados

| **Provider** | **Archivo** | **Modelos** | **Coste/1M** | **Estado** |
|-------------|-------------|-------------|-------------|-----------|
| **MiMo** | `MiMoProvider.ts` | mimo-v2-pro, mimo-v2-flash | $0 (Token Plan) | ✅ Refactorizado |
| **Kimi** | `KimiProvider.ts` | kimi-k2.6 | $0.95/$4.00 | ✅ Nuevo |
| **DeepSeek** | `DeepSeekProvider.ts` | deepseek-v4-flash/pro | $0.14-$1.74 | ✅ Nuevo |
| **Claude** | `ClaudeProvider.ts` | claude-sonnet-4-20250514 | $3.00/$15.00 | ✅ Nuevo |

**Características comunes:**
- Streaming SSE con parsing robusto
- Tool calling nativo
- Token estimation (~4 chars/token)
- Cost estimation por modelo
- Configuración via `vscode.workspace.getConfiguration()`

### 3. Sistema de Orquestación

**`src/orchestra/Director.ts`** — 417 líneas

```typescript
class CodingDirector {
  - createPlan()      // Fase 1: Kimi/Claude divide en subtareas
  - executeSubtask()  // Fase 2: Ejecución paralela por agentes
  - synthesizeResults() // Fase 3: Reconstrucción final
}
```

**Componentes:**
- `TaskRouter` — Selecciona agente según rol (architect→Kimi, coder→MiMo, reviewer→Claude)
- `SharedMemory` — Persistencia en `.orchestra-context.md` + memoria en RAM
- `BudgetGuard` — Límite configurable (default $5.00/orquestación)

### 4. Integración VS Code

**Comandos nuevos:**
```
🎼 Orchestra: Execute Complex Task   → Abre input, ejecuta orquestación
Orchestra: Show Status               → Muestra providers disponibles
Kimi: Configure API Key              → Configuración Kimi
DeepSeek: Configure API Key          → Configuración DeepSeek  
Claude: Configure API Key            → Configuración Claude
```

**UI:**
- Panel visual de resultados con estadísticas (coste, tokens, duración)
- Status bar: `🎼` botón de orquestación
- Webview con resumen de subtasks por agente

### 5. Configuración

**`package.json` actualizado con:**
```json
{
  "mimo.apiKey": "Token Plan o SK",
  "kimi.apiKey": "Moonshot API key", 
  "deepseek.apiKey": "DeepSeek API key",
  "claude.apiKey": "Anthropic API key",
  "orchestra.enabled": true,
  "orchestra.director": "kimi",
  "orchestra.budgetLimit": 5.0
}
```

---

## 🎯 OBJETIVOS PENDIENTES (Fases 2 y 3)

### **Fase 2: Comunicación Inter-Agente**

**Prioridad: ALTA**

1. **AgentMailbox** — Sistema de mensajería entre IAs
   ```typescript
   interface AgentMessage {
     from: string;      // "kimi-architect"
     to: string;        // "mimo-coder"  
     task: string;      // Descripción
     context: string;   // Contexto acumulado
     deliverables: string[];
   }
   ```
   - Cola persistente (archivo JSON o SQLite)
   - Notificaciones push entre agentes
   - Historial de conversaciones

2. **SharedMemory mejorada**
   - Vector embeddings para búsqueda semántica
   - Integrar ChromaDB o Pinecone (o local: `hnswlib`)
   - Contexto de proyecto indexado

3. **Auto-fallback inteligente**
   - Si un provider falla, reintentar con otro automáticamente
   - Guardar preferencias del usuario por tipo de tarea

### **Fase 3: Autonomía Completa**

**Prioridad: MEDIA**

4. **Visualización del grafo**
   - Webview con diagrama del flujo de agentes
   - Mostrar conexiones entre subtareas
   - Estado en tiempo real (ejecutando, esperando, completado)

5. **Auto-optimización**
   - El director aprende qué agente es mejor para cada tarea
   - Métricas: tiempo, coste, calidad del output
   - Ajustar routing basado en historial

6. **Swarm mode**
   - Los agentes pueden iniciar subtareas sin intervención del usuario
   - Delegación recursiva

---

## 🔧 DECISIONES TÉCNICAS TOMADAS

### 1. Patrón de diseño
- **Provider Pattern** para abstraer APIs (Open/Closed principle)
- **Director Pattern** para orquestación (Single Responsibility)
- **AsyncGenerator** para streaming (memoria eficiente)

### 2. Gestión de costes
- Budget guard por orquestación (no por request individual)
- Cost estimation basado en tokens (aproximado ~4 chars/token)
- MiMo Token Plan = $0 (prioridad económica)

### 3. Jerarquía de fallback
```
MiMo (Token Plan, $0) → DeepSeek ($0.14/M) → Kimi ($0.95/M) → Claude ($3.00/M)
```

### 4. Compatibilidad
- VS Code 1.90+ / Antigravity
- Node.js 20+
- TypeScript 5.4+

---

## 📁 ARCHIVOS CLAVE

```
src/
├── providers/
│   ├── BaseProvider.ts       ← Interfaz base, empezar aquí
│   ├── MiMoProvider.ts       ← Ejemplo completo de implementación
│   ├── KimiProvider.ts       ← API Moonshot
│   ├── DeepSeekProvider.ts   ← API DeepSeek
│   ├── ClaudeProvider.ts     ← API Anthropic (formato diferente)
│   └── index.ts              ← Exports
├── orchestra/
│   └── Director.ts           ← Orquestador, 417 líneas
├── extension.ts              ← Entry point con comandos
├── chat.ts                   ← Chat participant (sin cambios)
├── tools.ts                  ← Herramientas (read, write, edit, run)
└── webview.ts                ← UI del chat (sin cambios)
```

---

## 🚀 INSTRUCCIONES PARA CLAUDE

### **Tarea inmediata: Fase 2 - AgentMailbox**

**Contexto:** El sistema ya tiene un `CodingDirector` que divide tareas y las ejecuta, pero los agentes no pueden comunicarse entre sí. Necesitamos un sistema de mensajería.

**Objetivo:** Implementar `AgentMailbox` para que los agentes se envíen mensajes.

**Código base:** Revisa `src/orchestra/Director.ts` líneas 50-80 (SharedMemory) y 200-250 (executeSubtask).

**Requisitos:**
1. Crear `src/orchestra/AgentMailbox.ts`
2. Los agentes deben poder enviar/recibir mensajes durante la ejecución
3. Persistir mensajes en `.orchestra-mailbox.json`
4. Integrar en `CodingDirector` para que los agentes se comuniquen

**Ejemplo de uso:**
```typescript
// El coder (MiMo) envía su código al reviewer (Claude)
mailbox.send({
  from: 'mimo-coder',
  to: 'claude-reviewer', 
  task: 'Revisa este código JWT',
  code: outputDelCoder
});

// El reviewer responde
mailbox.send({
  from: 'claude-reviewer',
  to: 'mimo-coder',
  issues: ['Falta rate limiting', 'Usar bcrypt en vez de SHA256']
});
```

**Tests:** Verificar que los mensajes circulan entre agentes.

---

### **Tarea secundaria: Fase 2 - Vector Memory**

**Contexto:** `SharedMemory` actual guarda texto plano. Necesitamos búsqueda semántica.

**Objetivo:** Implementar embeddings para búsqueda por similitud.

**Opciones:**
- Opción A: Usar API de embeddings de un provider (Kimi/Claude)
- Opción B: Librería local (llama.cpp embeddings)
- Opción C: Simulación con TF-IDF (rápido, sin dependencias)

**Recomendación:** Opción C para empezar (sin dependencias externas).

---

### **Tarea terciaria: Refactorización**

**Contexto:** `MiMoProvider.ts` tiene ~270 líneas. Podría beneficiarse de una clase base `BaseAPIProvider`.

**Objetivo:** Extraer lógica común (streaming SSE, error handling, config) a una clase base.

---

## 💰 CONSIDERACIONES DE PRESUPUESTO

| **Provider** | **Coste estimado/testing** | **Recomendación** |
|-------------|---------------------------|------------------|
| **MiMo** | $0 (Token Plan ilimitado) | Usar para todo el testing |
| **DeepSeek** | ~$0.01 por test simple | Alternativa económica |
| **Kimi** | ~$0.05 por test simple | Para tareas complejas |
| **Claude** | ~$0.20 por test simple | Solo para review final |

**Estrategia de testing:**
1. Desarrollar todo con MiMo (gratis)
2. Verificar funcionamiento con DeepSeek (barato)
3. Test final con Kimi/Claude solo si es necesario

---

## 🔗 ENLACES

- **Repo:** https://github.com/drdelco/mimo-provider
- **Branch:** `feature/multi-provider-orchestra`
- **Commit:** `81637f5`
- **PR:** https://github.com/drdelco/mimo-provider/pull/new/feature/multi-provider-orchestra

---

## ❓ PREGUNTAS ABIERTAS

1. ¿Qué base de datos/librería usar para vector search? (Chroma, Pinecone, local)
2. ¿Los agentes deben poder llamar a otros agentes recursivamente?
3. ¿Qué formato de logging para auditoría de orquestaciones?
4. ¿Limitar número máximo de agentes en paralelo?

---

**Preparado por:** Alvi (Kimi K2.6)  
**Para:** Diego Ferrández / Claude Code  
**Nota:** Usar MiMo para testing (Token Plan ilimitado). Reservar Kimi/Claude para producción.

---

## 📊 RESUMEN EJECUTIVO

```
┌────────────────────────────────────────────┐
│  FASE 1 ✅ COMPLETADA                      │
│  - 4 providers implementados               │
│  - Orquestador funcional                   │
│  - UI básica de resultados                 │
│                                            │
│  FASE 2 ⏳ PENDIENTE                       │
│  - AgentMailbox (comunicación inter-IA)    │
│  - Vector Memory (embeddings)              │
│  - Auto-fallback inteligente               │
│                                            │
│  FASE 3 📋 FUTURO                          │
│  - Visualización del grafo                 │
│  - Auto-optimización                       │
│  - Swarm mode (autonomía total)            │
└────────────────────────────────────────────┘
```
