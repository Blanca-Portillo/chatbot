# Mi Negocio con WhatsApp Cloud API

Este proyecto incluye una demo web y un webhook compatible con **Meta WhatsApp Cloud API**.

## Configuración

1. Instala Node.js 18 o superior.
2. Copia `.env.example` a `.env` y completa:
   - `WHATSAPP_TOKEN`
   - `PHONE_NUMBER_ID`
   - `VERIFY_TOKEN`
   - `APP_SECRET` opcional
3. Ejecuta:

```powershell
$env:WHATSAPP_TOKEN="..."
$env:PHONE_NUMBER_ID="..."
$env:VERIFY_TOKEN="mi-token-secreto"
$env:APP_SECRET="..."
node server.js
```

O usa la configuración `.env` con un proceso que cargue variables; el servidor no incluye carga automática de `.env`.

4. Expón el servidor con HTTPS (por ejemplo, Cloudflare Tunnel, Render, Railway o un VPS).
5. En Meta Developers, configura el webhook como:
   - URL: `https://TU-DOMINIO/webhook`
   - Verify token: el mismo valor de `VERIFY_TOKEN`
   - Suscríbete al campo `messages`.

## Comandos

- `Vendí 3 bolsas de arroz y 2 botellas de aceite`
- `Entraron 20 libras de frijol rojo`
- `¿Cuánto llevo ganado esta semana?`

Los movimientos se guardan en `data/state.json` y el panel web usa el mismo motor mediante `/api/chat`.

El servidor acepta texto. Los audios de WhatsApp requieren agregar transcripción de voz (Whisper, Azure AI Speech u otro proveedor); no se crea una llamada a terceros sin una credencial configurada.
