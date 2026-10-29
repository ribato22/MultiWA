<?php

declare(strict_types=1);

namespace MultiWA\Tests;

use DateTimeImmutable;
use GuzzleHttp\Psr7\Query;
use GuzzleHttp\Psr7\Response;
use MultiWA\Clients\BroadcastsClient;
use MultiWA\Clients\ContactsClient;
use MultiWA\Clients\MessagesClient;
use MultiWA\Clients\ProfilesClient;
use MultiWA\Clients\WebhooksClient;
use MultiWA\Models\Broadcast;
use MultiWA\Models\Contact;
use MultiWA\Models\MessageResult;
use MultiWA\Models\Profile;
use MultiWA\Models\Webhook;
use MultiWA\MultiWA;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\RequestInterface;

/**
 * Every public client method: the request it sends (method, path, query, JSON
 * body), that the route exists in the API, and how it parses a real response.
 */
final class ClientTest extends TestCase
{
    private const ROUTES = __DIR__ . '/../../../scripts/api-routes.snapshot.json';

    private const SENT = [
        'success' => true,
        'messageId' => 'msg-1',
        'conversationId' => 'conv-1',
        'waMessageId' => 'true_6281234567890@c.us_3EB0A1B2C3D4',
        'status' => 'sent',
    ];

    private const PROFILE = [
        'id' => 'prof-1',
        'workspaceId' => 'ws-1',
        'accountId' => null,
        'displayName' => 'Sales',
        'phoneNumber' => '6281234567890',
        'pushName' => 'Sales Team',
        'profilePicUrl' => null,
        'status' => 'connected',
        'engine' => 'whatsapp-web-js',
        'messageDelayMs' => 1500,
        'dailyMessageLimit' => null,
        'lastConnectedAt' => '2026-10-28T01:00:00.000Z',
        'createdAt' => '2026-10-01T00:00:00.000Z',
        'updatedAt' => '2026-10-28T01:00:00.000Z',
    ];

    private const CONTACT = [
        'id' => 'contact-1',
        'profileId' => 'prof-1',
        'phone' => '6281234567890',
        'name' => 'Budi',
        'whatsappName' => 'Budi S',
        'avatarUrl' => null,
        'tags' => ['vip'],
        'metadata' => ['source' => 'web'],
        'isBlocked' => false,
        'lastMessageAt' => '2026-10-27T08:30:00.000Z',
        'createdAt' => '2026-10-01T00:00:00.000Z',
        'updatedAt' => '2026-10-27T08:30:00.000Z',
    ];

    private const BROADCAST = [
        'id' => 'bc-1',
        'profileId' => 'prof-1',
        'name' => 'October promo',
        'message' => ['type' => 'text', 'text' => 'Hello!'],
        'recipients' => ['type' => 'tags', 'value' => ['vip']],
        'status' => 'draft',
        'scheduledAt' => null,
        'startedAt' => null,
        'completedAt' => null,
        'settings' => ['delayMin' => 3000, 'delayMax' => 10000, 'batchSize' => 50, 'retryFailed' => true, 'retryAttempts' => 3],
        'stats' => ['total' => 0, 'pending' => 0, 'sent' => 0, 'delivered' => 0, 'read' => 0, 'failed' => 0],
        'resolvedRecipients' => null,
        'cursor' => 0,
        'createdAt' => '2026-10-28T02:00:00.000Z',
        'updatedAt' => '2026-10-28T02:00:00.000Z',
    ];

    private const WEBHOOK = [
        'id' => 'hook-1',
        'profileId' => 'prof-1',
        'url' => 'https://example.com/hook',
        'events' => ['message.received'],
        'secret' => 'server-generated-secret',
        'headers' => ['X-Tenant' => 'acme'],
        'enabled' => true,
        'createdAt' => '2026-10-28T03:00:00.000Z',
        'updatedAt' => '2026-10-28T03:00:00.000Z',
    ];

    /**
     * @param \Closure(MultiWA): mixed            $call
     * @param array<string, string|list<string>> $query
     * @param array<mixed>|null                  $body
     * @param array<mixed>                       $response
     * @param \Closure(mixed): void               $check
     */
    #[DataProvider('calls')]
    public function testCall(\Closure $call, string $method, string $path, array $query, ?array $body, array $response, \Closure $check): void
    {
        $client = $this->client([new Response($method === 'POST' ? 201 : 200, ['Content-Type' => 'application/json'], json_encode($response, JSON_THROW_ON_ERROR))]);

        $result = $call($client);

        $request = $this->onlyRequest();
        self::assertSame($method, $request->getMethod());
        self::assertSame($path, $request->getUri()->getPath());
        self::assertSame($query, self::query($request));
        self::assertSame('test-key', $request->getHeaderLine('X-API-Key'));
        if ($body === null) {
            self::assertSame('', (string) $request->getBody());
            // The API answers 400 to a bodiless POST that declares a JSON body.
            self::assertFalse($request->hasHeader('Content-Type'));
        } else {
            self::assertSame('application/json', $request->getHeaderLine('Content-Type'));
            self::assertJsonStringEqualsJsonString(json_encode($body, JSON_THROW_ON_ERROR), (string) $request->getBody());
        }
        self::assertRouteExists($method, $path);
        $check($result);
    }

    /**
     * @return iterable<string, array{\Closure, string, string, array<string, string|list<string>>, array<mixed>|null, array<mixed>, \Closure}>
     */
    public static function calls(): iterable
    {
        $sent = static function (mixed $r): void {
            self::assertInstanceOf(MessageResult::class, $r);
            self::assertTrue($r->success);
            self::assertSame('msg-1', $r->messageId);
            self::assertSame('conv-1', $r->conversationId);
            self::assertSame('sent', $r->status);
            self::assertSame('true_6281234567890@c.us_3EB0A1B2C3D4', $r->waMessageId);
            self::assertNull($r->error);
        };
        $to = '6281234567890';

        // Messages
        yield 'messages.sendText' => self::case(
            fn (MultiWA $c) => $c->messages()->sendText('prof-1', $to, 'Hello'),
            'POST', '/api/v1/messages/text', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'text' => 'Hello'],
        );
        yield 'messages.sendText quoting a message' => self::case(
            fn (MultiWA $c) => $c->messages()->sendText('prof-1', $to, 'Yes', quotedMessageId: 'false_6281234567890@c.us_3EB0'),
            'POST', '/api/v1/messages/text', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'text' => 'Yes', 'quotedMessageId' => 'false_6281234567890@c.us_3EB0'],
        );
        yield 'messages.sendImage' => self::case(
            fn (MultiWA $c) => $c->messages()->sendImage('prof-1', $to, url: 'https://example.com/a.jpg', caption: 'Look'),
            'POST', '/api/v1/messages/image', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'url' => 'https://example.com/a.jpg', 'caption' => 'Look'],
        );
        yield 'messages.sendVideo' => self::case(
            fn (MultiWA $c) => $c->messages()->sendVideo('prof-1', $to, base64: 'AAAA', mimetype: 'video/mp4'),
            'POST', '/api/v1/messages/video', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'base64' => 'AAAA', 'mimetype' => 'video/mp4'],
        );
        yield 'messages.sendAudio' => self::case(
            fn (MultiWA $c) => $c->messages()->sendAudio('prof-1', $to, url: 'https://example.com/a.ogg', ptt: true),
            'POST', '/api/v1/messages/audio', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'url' => 'https://example.com/a.ogg', 'ptt' => true],
        );
        yield 'messages.sendDocument' => self::case(
            fn (MultiWA $c) => $c->messages()->sendDocument('prof-1', $to, 'report.pdf', url: 'https://example.com/r.pdf', caption: 'Q3'),
            'POST', '/api/v1/messages/document', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'filename' => 'report.pdf', 'url' => 'https://example.com/r.pdf', 'caption' => 'Q3'],
        );
        yield 'messages.sendLocation' => self::case(
            fn (MultiWA $c) => $c->messages()->sendLocation('prof-1', $to, -6.2088, 106.8456, name: 'Monas'),
            'POST', '/api/v1/messages/location', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'latitude' => -6.2088, 'longitude' => 106.8456, 'name' => 'Monas'],
        );
        yield 'messages.sendContact' => self::case(
            fn (MultiWA $c) => $c->messages()->sendContact('prof-1', $to, 'Budi', '6281111111111'),
            'POST', '/api/v1/messages/contact', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'contacts' => [['name' => 'Budi', 'phone' => '6281111111111']]],
        );
        yield 'messages.sendPoll' => self::case(
            fn (MultiWA $c) => $c->messages()->sendPoll('prof-1', $to, 'Lunch?', ['Rice', 'Noodles']),
            'POST', '/api/v1/messages/poll', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'to' => $to, 'question' => 'Lunch?', 'options' => ['Rice', 'Noodles'], 'allowMultipleAnswers' => false],
        );
        yield 'messages.sendReaction' => self::case(
            fn (MultiWA $c) => $c->messages()->sendReaction('prof-1', 'msg-1', '👍'),
            'POST', '/api/v1/messages/reaction', self::SENT, $sent,
            body: ['profileId' => 'prof-1', 'messageId' => 'msg-1', 'emoji' => '👍'],
        );
        yield 'messages.list' => self::case(
            fn (MultiWA $c) => $c->messages()->list('prof-1', type: 'text'),
            'GET', '/api/v1/messages/profile/prof-1',
            [['id' => 'msg-1', 'profileId' => 'prof-1', 'direction' => 'incoming', 'type' => 'text', 'content' => ['text' => 'Hi'], 'conversation' => ['id' => 'conv-1']]],
            static function (mixed $r): void {
                self::assertIsArray($r);
                self::assertSame('msg-1', $r[0]['id']);
            },
            query: ['limit' => '50', 'offset' => '0', 'type' => 'text'],
        );

        // Contacts
        $contact = static function (mixed $r): void {
            self::assertInstanceOf(Contact::class, $r);
            self::assertSame('contact-1', $r->id);
            self::assertSame('Budi S', $r->whatsappName);
            self::assertSame(['vip'], $r->tags);
            self::assertSame(['source' => 'web'], $r->metadata);
            self::assertEquals(new DateTimeImmutable('2026-10-27T08:30:00.000Z'), $r->lastMessageAt);
        };
        yield 'contacts.create' => self::case(
            fn (MultiWA $c) => $c->contacts()->create('prof-1', $to, name: 'Budi', tags: ['vip'], metadata: ['source' => 'web']),
            'POST', '/api/v1/contacts', self::CONTACT, $contact,
            body: ['profileId' => 'prof-1', 'phone' => $to, 'name' => 'Budi', 'tags' => ['vip'], 'metadata' => ['source' => 'web']],
        );
        yield 'contacts.create with only a phone' => self::case(
            fn (MultiWA $c) => $c->contacts()->create('prof-1', $to),
            'POST', '/api/v1/contacts', self::CONTACT, $contact,
            body: ['profileId' => 'prof-1', 'phone' => $to],
        );
        yield 'contacts.get' => self::case(
            fn (MultiWA $c) => $c->contacts()->get('contact-1'),
            'GET', '/api/v1/contacts/contact-1', self::CONTACT, $contact,
        );
        yield 'contacts.list' => self::case(
            fn (MultiWA $c) => $c->contacts()->list('prof-1', search: 'bud', tags: ['vip', 'new']),
            'GET', '/api/v1/contacts',
            ['contacts' => [self::CONTACT], 'total' => 1, 'limit' => 50, 'offset' => 0],
            static function (mixed $r) use ($contact): void {
                self::assertIsArray($r);
                self::assertSame(1, $r['total']);
                self::assertSame(50, $r['limit']);
                self::assertSame(0, $r['offset']);
                self::assertCount(1, $r['contacts']);
                $contact($r['contacts'][0]);
            },
            // Repeated, not tags[0]=…: the API ignores the bracket form.
            query: ['limit' => '50', 'offset' => '0', 'profileId' => 'prof-1', 'search' => 'bud', 'tags' => ['vip', 'new']],
        );
        yield 'contacts.update' => self::case(
            fn (MultiWA $c) => $c->contacts()->update('contact-1', name: 'Budi', metadata: []),
            'PUT', '/api/v1/contacts/contact-1', self::CONTACT, $contact,
            // metadata must stay a JSON object even when empty.
            body: ['name' => 'Budi', 'metadata' => new \stdClass()],
        );
        yield 'contacts.delete' => self::case(
            fn (MultiWA $c) => $c->contacts()->delete('contact-1'),
            'DELETE', '/api/v1/contacts/contact-1', ['success' => true],
            static fn (mixed $r) => self::assertSame(['success' => true], $r),
        );

        // Broadcasts
        $broadcast = static function (string $status): \Closure {
            return static function (mixed $r) use ($status): void {
                self::assertInstanceOf(Broadcast::class, $r);
                self::assertSame('bc-1', $r->id);
                self::assertSame($status, $r->status);
                self::assertSame(['type' => 'text', 'text' => 'Hello!'], $r->message);
                self::assertSame(['type' => 'tags', 'value' => ['vip']], $r->recipients);
                self::assertSame(0, $r->stats['total']);
            };
        };
        yield 'broadcasts.create' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->create(
                'prof-1',
                'October promo',
                ['type' => 'image', 'url' => 'https://example.com/promo.jpg', 'text' => 'Promo'],
                ['type' => 'tags', 'value' => ['vip']],
                ['delayMin' => 5000, 'delayMax' => 15000],
            ),
            'POST', '/api/v1/broadcast', self::BROADCAST, $broadcast('draft'),
            body: [
                'profileId' => 'prof-1',
                'name' => 'October promo',
                'message' => ['type' => 'image', 'url' => 'https://example.com/promo.jpg', 'text' => 'Promo'],
                'recipients' => ['type' => 'tags', 'value' => ['vip']],
                'settings' => ['delayMin' => 5000, 'delayMax' => 15000],
            ],
        );
        yield 'broadcasts.create with a text to all contacts' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->create('prof-1', 'October promo', 'Hello!', ['type' => 'all']),
            'POST', '/api/v1/broadcast', self::BROADCAST, $broadcast('draft'),
            body: [
                'profileId' => 'prof-1',
                'name' => 'October promo',
                'message' => ['type' => 'text', 'text' => 'Hello!'],
                'recipients' => ['type' => 'all', 'value' => []],
            ],
        );
        yield 'broadcasts.get' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->get('bc-1'),
            'GET', '/api/v1/broadcast/bc-1', self::BROADCAST, $broadcast('draft'),
        );
        yield 'broadcasts.list' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->list('prof-1', 'running'),
            'GET', '/api/v1/broadcast', [['status' => 'running'] + self::BROADCAST],
            static function (mixed $r) use ($broadcast): void {
                self::assertIsArray($r);
                self::assertCount(1, $r);
                $broadcast('running')($r[0]);
            },
            query: ['profileId' => 'prof-1', 'status' => 'running'],
        );
        yield 'broadcasts.update' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->update('bc-1', name: 'October promo', message: 'Hello!'),
            'PUT', '/api/v1/broadcast/bc-1', self::BROADCAST, $broadcast('draft'),
            body: ['name' => 'October promo', 'message' => ['type' => 'text', 'text' => 'Hello!']],
        );
        yield 'broadcasts.schedule' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->schedule('bc-1', new DateTimeImmutable('2026-11-01T09:00:00+07:00')),
            'POST', '/api/v1/broadcast/bc-1/schedule',
            ['status' => 'scheduled', 'scheduledAt' => '2026-11-01T02:00:00.000Z'] + self::BROADCAST,
            static function (mixed $r) use ($broadcast): void {
                $broadcast('scheduled')($r);
                self::assertInstanceOf(Broadcast::class, $r);
                self::assertEquals(new DateTimeImmutable('2026-11-01T02:00:00Z'), $r->scheduledAt);
            },
            body: ['scheduledAt' => '2026-11-01T09:00:00+07:00'],
        );
        yield 'broadcasts.start' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->start('bc-1'),
            'POST', '/api/v1/broadcast/bc-1/start',
            ['success' => true, 'message' => 'Broadcast started', 'recipientCount' => 42],
            static fn (mixed $r) => self::assertSame(['success' => true, 'message' => 'Broadcast started', 'recipientCount' => 42], $r),
        );
        yield 'broadcasts.pause' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->pause('bc-1'),
            'POST', '/api/v1/broadcast/bc-1/pause', ['status' => 'paused'] + self::BROADCAST, $broadcast('paused'),
        );
        yield 'broadcasts.resume' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->resume('bc-1'),
            'POST', '/api/v1/broadcast/bc-1/resume', ['success' => true, 'message' => 'Broadcast resumed'],
            static fn (mixed $r) => self::assertSame(['success' => true, 'message' => 'Broadcast resumed'], $r),
        );
        yield 'broadcasts.cancel' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->cancel('bc-1'),
            'POST', '/api/v1/broadcast/bc-1/cancel', ['status' => 'failed', 'completedAt' => '2026-10-28T04:00:00.000Z'] + self::BROADCAST, $broadcast('failed'),
        );
        yield 'broadcasts.delete' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->delete('bc-1'),
            'DELETE', '/api/v1/broadcast/bc-1', ['success' => true],
            static fn (mixed $r) => self::assertSame(['success' => true], $r),
        );
        $stats = [
            'id' => 'bc-1',
            'name' => 'October promo',
            'status' => 'completed',
            'scheduledAt' => null,
            'startedAt' => '2026-10-28T02:00:00.000Z',
            'completedAt' => '2026-10-28T02:10:00.000Z',
            'stats' => ['total' => 10, 'pending' => 0, 'sent' => 9, 'delivered' => 8, 'read' => 5, 'failed' => 1, 'successRate' => 80, 'progress' => 100],
            'duration' => 600,
        ];
        yield 'broadcasts.stats' => self::case(
            fn (MultiWA $c) => $c->broadcasts()->stats('bc-1'),
            'GET', '/api/v1/broadcast/bc-1/stats', $stats,
            static fn (mixed $r) => self::assertSame($stats, $r),
        );

        // Profiles
        $profile = static function (mixed $r): void {
            self::assertInstanceOf(Profile::class, $r);
            self::assertSame('prof-1', $r->id);
            self::assertSame('Sales', $r->displayName);
            self::assertSame('6281234567890', $r->phoneNumber);
            self::assertSame('connected', $r->status);
            self::assertEquals(new DateTimeImmutable('2026-10-28T01:00:00.000Z'), $r->lastConnectedAt);
        };
        yield 'profiles.create' => self::case(
            fn (MultiWA $c) => $c->profiles()->create('ws-1', 'Sales'),
            'POST', '/api/v1/profiles', self::PROFILE, $profile,
            body: ['workspaceId' => 'ws-1', 'name' => 'Sales'],
        );
        yield 'profiles.get' => self::case(
            fn (MultiWA $c) => $c->profiles()->get('prof-1'),
            'GET', '/api/v1/profiles/prof-1', self::PROFILE + ['workspace' => ['id' => 'ws-1']], $profile,
        );
        yield 'profiles.list' => self::case(
            fn (MultiWA $c) => $c->profiles()->list('ws-1'),
            'GET', '/api/v1/profiles',
            [self::PROFILE + ['name' => 'Sales', 'phone' => '6281234567890', 'messageCount' => 12, 'workspace' => ['id' => 'ws-1']]],
            static function (mixed $r) use ($profile): void {
                self::assertIsArray($r);
                self::assertCount(1, $r);
                $profile($r[0]);
                self::assertSame(12, $r[0]->messageCount);
            },
            query: ['workspaceId' => 'ws-1'],
        );
        yield 'profiles.update' => self::case(
            fn (MultiWA $c) => $c->profiles()->update('prof-1', name: 'Sales', engine: 'baileys'),
            'PUT', '/api/v1/profiles/prof-1',
            ['engine' => 'baileys', 'warning' => 'Engine change will take effect on next reconnect.'] + self::PROFILE,
            static function (mixed $r) use ($profile): void {
                $profile($r);
                self::assertInstanceOf(Profile::class, $r);
                self::assertSame('baileys', $r->engine);
                self::assertSame('Engine change will take effect on next reconnect.', $r->warning);
            },
            body: ['name' => 'Sales', 'engine' => 'baileys'],
        );
        yield 'profiles.delete' => self::case(
            fn (MultiWA $c) => $c->profiles()->delete('prof-1'),
            'DELETE', '/api/v1/profiles/prof-1', ['success' => true],
            static fn (mixed $r) => self::assertSame(['success' => true], $r),
        );
        yield 'profiles.connect' => self::case(
            fn (MultiWA $c) => $c->profiles()->connect('prof-1'),
            'POST', '/api/v1/profiles/prof-1/connect', ['status' => 'connecting', 'message' => 'Scan QR code to connect'],
            static fn (mixed $r) => self::assertSame(['status' => 'connecting', 'message' => 'Scan QR code to connect'], $r),
        );
        yield 'profiles.disconnect' => self::case(
            fn (MultiWA $c) => $c->profiles()->disconnect('prof-1'),
            'POST', '/api/v1/profiles/prof-1/disconnect', ['status' => 'disconnected'],
            static fn (mixed $r) => self::assertSame(['status' => 'disconnected'], $r),
        );
        $status = ['id' => 'prof-1', 'name' => 'Sales', 'status' => 'connected', 'phone' => '6281234567890', 'lastConnectedAt' => '2026-10-28T01:00:00.000Z', 'engineConnected' => true];
        yield 'profiles.status' => self::case(
            fn (MultiWA $c) => $c->profiles()->status('prof-1'),
            'GET', '/api/v1/profiles/prof-1/status', $status,
            static fn (mixed $r) => self::assertSame($status, $r),
        );

        // Webhooks
        $webhook = static function (mixed $r): void {
            self::assertInstanceOf(Webhook::class, $r);
            self::assertSame('hook-1', $r->id);
            self::assertSame(['message.received'], $r->events);
            self::assertTrue($r->enabled);
            self::assertSame('server-generated-secret', $r->secret);
            self::assertSame(['X-Tenant' => 'acme'], $r->headers);
        };
        yield 'webhooks.create' => self::case(
            fn (MultiWA $c) => $c->webhooks()->create('prof-1', 'https://example.com/hook', ['message.received'], ['X-Tenant' => 'acme']),
            'POST', '/api/v1/webhooks', self::WEBHOOK, $webhook,
            body: ['profileId' => 'prof-1', 'url' => 'https://example.com/hook', 'events' => ['message.received'], 'headers' => ['X-Tenant' => 'acme']],
        );
        yield 'webhooks.get' => self::case(
            fn (MultiWA $c) => $c->webhooks()->get('hook-1'),
            'GET', '/api/v1/webhooks/hook-1', self::WEBHOOK, $webhook,
        );
        yield 'webhooks.list' => self::case(
            fn (MultiWA $c) => $c->webhooks()->list('prof-1'),
            'GET', '/api/v1/webhooks', [self::WEBHOOK + ['profile' => ['id' => 'prof-1', 'displayName' => 'Sales']]],
            static function (mixed $r) use ($webhook): void {
                self::assertIsArray($r);
                self::assertCount(1, $r);
                $webhook($r[0]);
            },
            query: ['profileId' => 'prof-1'],
        );
        yield 'webhooks.update' => self::case(
            fn (MultiWA $c) => $c->webhooks()->update('hook-1', events: ['message.received'], enabled: true),
            'PUT', '/api/v1/webhooks/hook-1', self::WEBHOOK, $webhook,
            body: ['events' => ['message.received'], 'enabled' => true],
        );
        yield 'webhooks.delete' => self::case(
            fn (MultiWA $c) => $c->webhooks()->delete('hook-1'),
            'DELETE', '/api/v1/webhooks/hook-1', ['success' => true],
            static fn (mixed $r) => self::assertSame(['success' => true], $r),
        );
        yield 'webhooks.test' => self::case(
            fn (MultiWA $c) => $c->webhooks()->test('hook-1'),
            'POST', '/api/v1/webhooks/hook-1/test', ['success' => true, 'message' => 'Test webhook delivered successfully'],
            static fn (mixed $r) => self::assertSame(['success' => true, 'message' => 'Test webhook delivered successfully'], $r),
        );
    }

    public function testEveryPublicClientMethodHasACase(): void
    {
        $clients = [
            'messages' => MessagesClient::class,
            'contacts' => ContactsClient::class,
            'broadcasts' => BroadcastsClient::class,
            'profiles' => ProfilesClient::class,
            'webhooks' => WebhooksClient::class,
        ];
        $methods = [];
        foreach ($clients as $name => $class) {
            foreach ((new \ReflectionClass($class))->getMethods(\ReflectionMethod::IS_PUBLIC) as $method) {
                if (!$method->isConstructor() && !$method->isStatic()) {
                    $methods[] = "{$name}.{$method->getName()}";
                }
            }
        }
        // A case is named "client.method", optionally followed by a description.
        $cases = array_unique(array_map(
            static fn (string $name) => explode(' ', $name)[0],
            array_keys(iterator_to_array(self::calls())),
        ));
        sort($methods);
        sort($cases);

        self::assertSame($methods, $cases);
    }

    public function testRequestReachesAnyRouteAndKeepsTheApiPrefix(): void
    {
        $client = $this->client([new Response(201, [], '{"success":true,"channel":"primary"}')]);

        $result = $client->request('POST', '/messages/otp', ['json' => ['profileId' => 'prof-1', 'to' => '6281234567890', 'text' => 'Code 123456', 'code' => '123456']]);

        self::assertSame(['success' => true, 'channel' => 'primary'], $result);
        self::assertSame('https://wa.example.com/api/v1/messages/otp', (string) $this->onlyRequest()->getUri());
        self::assertRouteExists('POST', '/api/v1/messages/otp');
    }

    public function testBaseUrlWithATrailingSlash(): void
    {
        $client = $this->client([new Response(200, [], '{"status":"disconnected"}')], self::BASE_URL . '/');

        $client->profiles()->disconnect('prof-1');

        self::assertSame('https://wa.example.com/api/v1/profiles/prof-1/disconnect', (string) $this->onlyRequest()->getUri());
    }

    public function testPathParametersAreEncoded(): void
    {
        $client = $this->client([new Response(200, [], json_encode(self::CONTACT, JSON_THROW_ON_ERROR))]);

        $client->contacts()->get('a/b?c');

        self::assertSame('/api/v1/contacts/a%2Fb%3Fc', $this->onlyRequest()->getUri()->getPath());
    }

    public function testBroadcastStoredWithATextMessage(): void
    {
        $broadcast = Broadcast::fromArray(['message' => 'Hello!'] + self::BROADCAST);

        self::assertSame(['type' => 'text', 'text' => 'Hello!'], $broadcast->message);
    }

    public function testVerifySignature(): void
    {
        $body = '{"event":"message.received","profileId":"prof-1","data":{}}';
        $signature = 'sha256=' . hash_hmac('sha256', $body, 'secret');

        self::assertTrue(WebhooksClient::verifySignature($body, $signature, 'secret'));
        self::assertFalse(WebhooksClient::verifySignature($body . ' ', $signature, 'secret'));
        self::assertFalse(WebhooksClient::verifySignature($body, $signature, 'other-secret'));
        self::assertFalse(WebhooksClient::verifySignature($body, null, 'secret'));
        self::assertFalse(WebhooksClient::verifySignature($body, $signature, ''));
    }

    /**
     * @param \Closure(MultiWA): mixed            $call
     * @param array<mixed>                       $response
     * @param \Closure(mixed): void               $check
     * @param array<string, string|list<string>> $query
     * @param array<mixed>|null                  $body
     *
     * @return array{\Closure, string, string, array<string, string|list<string>>, array<mixed>|null, array<mixed>, \Closure}
     */
    private static function case(\Closure $call, string $method, string $path, array $response, \Closure $check, array $query = [], ?array $body = null): array
    {
        ksort($query);

        return [$call, $method, $path, $query, $body, $response, $check];
    }

    /**
     * @return array<string, string|list<string>>
     */
    private static function query(RequestInterface $request): array
    {
        $query = Query::parse($request->getUri()->getQuery());
        ksort($query);

        return $query;
    }

    private static function assertRouteExists(string $method, string $path): void
    {
        if (!is_file(self::ROUTES)) {
            self::markTestSkipped('scripts/api-routes.snapshot.json is only in the MultiWA monorepo');
        }
        /** @var array{routes: list<array{method: string, path: string}>} $snapshot */
        $snapshot = json_decode((string) file_get_contents(self::ROUTES), true, 512, JSON_THROW_ON_ERROR);

        $segments = explode('/', $path);
        $matches = array_filter($snapshot['routes'], static function (array $route) use ($method, $segments): bool {
            $routeSegments = explode('/', $route['path']);
            if ($route['method'] !== $method || count($routeSegments) !== count($segments)) {
                return false;
            }
            foreach ($routeSegments as $i => $segment) {
                // A :param segment matches any value.
                if ($segment !== $segments[$i] && !str_starts_with($segment, ':')) {
                    return false;
                }
            }

            return true;
        });

        self::assertNotEmpty($matches, "{$method} {$path} is not a route in scripts/api-routes.snapshot.json");
    }
}
