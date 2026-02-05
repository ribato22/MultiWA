<?php
/**
 * Plugin Name: MultiWA WhatsApp Gateway
 * Plugin URI: https://github.com/ribato22/multiwa
 * Description: Integrate WhatsApp messaging into WordPress using MultiWA Gateway. Send notifications, chat widgets, and WooCommerce order updates.
 * Version: 1.0.0
 * Author: MultiWA
 * License: MIT
 * Text Domain: multiwa
 */

if (!defined('ABSPATH')) exit;

define('MULTIWA_VERSION', '1.0.0');
define('MULTIWA_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('MULTIWA_PLUGIN_URL', plugin_dir_url(__FILE__));

// ─── Settings Page ────────────────────────────────────────────────────────

add_action('admin_menu', function() {
    add_options_page(
        'MultiWA Settings',
        'MultiWA',
        'manage_options',
        'multiwa-settings',
        'multiwa_settings_page'
    );
});

add_action('admin_init', function() {
    register_setting('multiwa_options', 'multiwa_api_url');
    register_setting('multiwa_options', 'multiwa_api_key');
    register_setting('multiwa_options', 'multiwa_profile_id');
    register_setting('multiwa_options', 'multiwa_woo_enabled');
    register_setting('multiwa_options', 'multiwa_woo_template');
});

function multiwa_settings_page() {
    ?>
    <div class="wrap">
        <h1>MultiWA WhatsApp Gateway</h1>
        <form method="post" action="options.php">
            <?php settings_fields('multiwa_options'); ?>
            <table class="form-table">
                <tr>
                    <th>API URL</th>
                    <td>
                        <input type="url" name="multiwa_api_url" value="<?php echo esc_attr(get_option('multiwa_api_url', 'http://localhost:3001')); ?>" class="regular-text" />
                        <p class="description">MultiWA Gateway base URL</p>
                    </td>
                </tr>
                <tr>
                    <th>API Key</th>
                    <td>
                        <input type="password" name="multiwa_api_key" value="<?php echo esc_attr(get_option('multiwa_api_key', '')); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th>Profile ID</th>
                    <td>
                        <input type="text" name="multiwa_profile_id" value="<?php echo esc_attr(get_option('multiwa_profile_id', '')); ?>" class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th>WooCommerce Notifications</th>
                    <td>
                        <label>
                            <input type="checkbox" name="multiwa_woo_enabled" value="1" <?php checked(get_option('multiwa_woo_enabled'), '1'); ?> />
                            Send WhatsApp order status notifications
                        </label>
                    </td>
                </tr>
                <tr>
                    <th>Order Notification Template</th>
                    <td>
                        <textarea name="multiwa_woo_template" rows="4" class="large-text"><?php echo esc_textarea(get_option('multiwa_woo_template', 'Hello {{name}}, your order #{{order_id}} status: {{status}}')); ?></textarea>
                        <p class="description">Variables: {{name}}, {{order_id}}, {{status}}, {{total}}</p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

// ─── API Client ───────────────────────────────────────────────────────────

function multiwa_send_message($to, $text) {
    $api_url = get_option('multiwa_api_url', 'http://localhost:3001');
    $api_key = get_option('multiwa_api_key', '');
    $profile_id = get_option('multiwa_profile_id', '');

    if (empty($api_key) || empty($profile_id)) {
        error_log('[MultiWA] API key or Profile ID not configured');
        return false;
    }

    $response = wp_remote_post("$api_url/messages/text", [
        'headers' => [
            'Content-Type' => 'application/json',
            'x-api-key' => $api_key,
        ],
        'body' => json_encode([
            'profileId' => $profile_id,
            'to' => $to,
            'text' => $text,
        ]),
        'timeout' => 15,
    ]);

    if (is_wp_error($response)) {
        error_log('[MultiWA] Send failed: ' . $response->get_error_message());
        return false;
    }

    return json_decode(wp_remote_retrieve_body($response), true);
}

// ─── WooCommerce Integration ──────────────────────────────────────────────

add_action('woocommerce_order_status_changed', function($order_id, $old_status, $new_status) {
    if (get_option('multiwa_woo_enabled') !== '1') return;

    $order = wc_get_order($order_id);
    if (!$order) return;

    $phone = $order->get_billing_phone();
    if (empty($phone)) return;

    // Clean phone number (ensure it starts with country code)
    $phone = preg_replace('/[^0-9]/', '', $phone);
    if (substr($phone, 0, 1) === '0') {
        $phone = '62' . substr($phone, 1); // Default: Indonesia
    }
    $phone .= '@s.whatsapp.net';

    // Build message from template
    $template = get_option('multiwa_woo_template', 'Hello {{name}}, your order #{{order_id}} status: {{status}}');
    $message = str_replace(
        ['{{name}}', '{{order_id}}', '{{status}}', '{{total}}'],
        [
            $order->get_billing_first_name(),
            $order_id,
            ucfirst($new_status),
            $order->get_formatted_order_total(),
        ],
        $template
    );

    multiwa_send_message($phone, $message);
}, 10, 3);

// ─── Shortcode: WhatsApp Chat Button ──────────────────────────────────────

add_shortcode('multiwa_chat', function($atts) {
    $atts = shortcode_atts([
        'phone' => '',
        'message' => 'Hello!',
        'text' => 'Chat on WhatsApp',
        'color' => '#25D366',
    ], $atts);

    if (empty($atts['phone'])) return '';

    return sprintf(
        '<a href="https://wa.me/%s?text=%s" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:8px;background:%s;color:white;padding:12px 24px;border-radius:30px;text-decoration:none;font-weight:600;font-size:16px;box-shadow:0 4px 12px rgba(37,211,102,0.3);transition:transform 0.2s" onmouseover="this.style.transform=\'scale(1.05)\'" onmouseout="this.style.transform=\'scale(1)\'"><svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/></svg>%s</a>',
        esc_attr($atts['phone']),
        urlencode($atts['message']),
        esc_attr($atts['color']),
        esc_html($atts['text'])
    );
});
