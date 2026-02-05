# MultiWA WordPress Plugin

Integrate WhatsApp messaging into WordPress using MultiWA Gateway.

## Features

- 🔔 **WooCommerce Order Notifications** – Automatic WhatsApp messages on order status changes
- 💬 **Chat Button Shortcode** – Add WhatsApp chat buttons anywhere
- ⚙️ **Easy Configuration** – Settings page under Settings → MultiWA
- 📝 **Message Templates** – Customizable templates with variables

## Installation

1. Copy the `wordpress-plugin` folder to `wp-content/plugins/multiwa`
2. Activate the plugin in WordPress admin
3. Go to **Settings → MultiWA** and configure your API credentials

## Configuration

| Setting | Description |
|---------|-------------|
| API URL | Your MultiWA Gateway URL (e.g., `https://wa.example.com`) |
| API Key | API key from MultiWA dashboard |
| Profile ID | WhatsApp profile to send from |

## Shortcode

```
[multiwa_chat phone="6281234567890" message="Hi!" text="Chat with us" color="#25D366"]
```

## WooCommerce Template Variables

| Variable | Description |
|----------|-------------|
| `{{name}}` | Customer first name |
| `{{order_id}}` | Order number |
| `{{status}}` | New order status |
| `{{total}}` | Formatted order total |
