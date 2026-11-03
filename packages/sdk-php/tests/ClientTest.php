<?php

declare(strict_types=1);

namespace MultiWA\Tests;

use DateTimeImmutable;
use GuzzleHttp\Psr7\Query;
use GuzzleHttp\Psr7\Response;
use MultiWA\Clients\BroadcastsClient;
use MultiWA\Clients\CallsClient;
use MultiWA\Clients\ContactsClient;
use MultiWA\Clients\MessagesClient;
use MultiWA\Clients\ProfilesClient;
use MultiWA\Clients\WebhooksClient;
use MultiWA\Exceptions\ApiException;
use MultiWA\Models\AudioFile;
use MultiWA\Models\Broadcast;
use MultiWA\Models\Call;
use MultiWA\Models\CallPage;
use MultiWA\Models\CallsSettings;
use MultiWA\Models\Contact;
use MultiWA\Models\MessageResult;
use MultiWA\Models\Profile;
use MultiWA\Models\Webhook;
use MultiWA\MultiWA;
use PHPUnit\Framework\Attributes\DataProvider;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;

/**
 * Every public client method: the request it sends (method, path, query, JSON
 * body or multipart parts), that the route exists in the API, and how it parses
 * a real response.
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

    private const RECORDING = [
        'id' => 'rec-1',
        'durationSec' => 190,
        'bytes' => 95000,
        'partial' => false,
        'announcementPlayed' => true,
        'createdAt' => '2026-11-01T03:03:20.000Z',
        'deletedAt' => null,
        'deleteReason' => null,
    ];

    // A call answered in the dashboard, with its relations and its recording.
    private const CALL = [
        'id' => 'call-1',
        'profileId' => 'prof-1',
        'waCallId' => 'W1',
        'fromJid' => '6281234567890@s.whatsapp.net',
        'isVideo' => false,
        'isGroup' => false,
        'direction' => 'incoming',
        'outcome' => 'answered',
        'rejectedBy' => null,
        'startedAt' => '2026-11-01T03:00:00.000Z',
        'endedAt' => '2026-11-01T03:03:18.000Z',
        'followUp' => 'done',
        'assignedUserId' => null,
        'answeredByUserId' => 'user-2',
        'answeredAt' => '2026-11-01T03:00:06.000Z',
        'endedBy' => 'caller',
        'endReason' => 'caller_hangup',
        'talkSeconds' => 192,
        'autoReplySentAt' => null,
        'conversationId' => 'conv-1',
        'metadata' => [],
        'createdAt' => '2026-11-01T03:00:00.000Z',
        'updatedAt' => '2026-11-01T03:03:20.000Z',
        'assignedUser' => null,
        'answeredBy' => ['id' => 'user-2', 'name' => 'Jane'],
        'conversation' => ['id' => 'conv-1', 'name' => 'Budi'],
        'recording' => self::RECORDING,
    ];

    // An mp3 file's first bytes (its ID3 tag): the audio the upload tests send.
    private const AUDIO = "ID3\x04";

    private const CALLS_SETTINGS = [
        'profileId' => 'prof-1',
        'answerInDashboard' => true,
        'recording' => true,
        'retentionDays' => 30,
        'announcement' => ['mimeType' => 'audio/mpeg', 'durationSec' => 6.2],
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
     * @param array<string, array{string, string}>|null $multipart name => [filename, contents]
     */
    #[DataProvider('calls')]
    public function testCall(\Closure $call, string $method, string $path, array $query, ?array $body, array $response, \Closure $check, ?ResponseInterface $reply, ?array $multipart): void
    {
        $client = $this->client([$reply ?? new Response($method === 'POST' ? 201 : 200, ['Content-Type' => 'application/json'], json_encode($response, JSON_THROW_ON_ERROR))]);

        $result = $call($client);

        $request = $this->onlyRequest();
        self::assertSame($method, $request->getMethod());
        self::assertSame($path, $request->getUri()->getPath());
        self::assertSame($query, self::query($request));
        self::assertSame('test-key', $request->getHeaderLine('X-API-Key'));
        if ($multipart !== null) {
            // A file upload is multipart, with the boundary Guzzle chose.
            self::assertStringStartsWith('multipart/form-data; boundary=', $request->getHeaderLine('Content-Type'));
            self::assertSame($multipart, self::parts($request));
        } elseif ($body === null) {
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
     * @return iterable<string, array{\Closure, string, string, array<string, string|list<string>>, array<mixed>|null, array<mixed>, \Closure, ResponseInterface|null, array<string, array{string, string}>|null}>
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

        // Calls
        $call = static function (mixed $r): void {
            self::assertInstanceOf(Call::class, $r);
            self::assertSame('answered', $r->outcome);
            self::assertSame(['id' => 'user-2', 'name' => 'Jane'], $r->answeredBy);
            self::assertSame(192, $r->talkSeconds);
            self::assertSame(190, $r->recording?->durationSec);
            self::assertEquals(new DateTimeImmutable('2026-11-01T03:00:06Z'), $r->answeredAt);
        };
        $audio = static fn (string $bytes, string $type) => new Response(200, ['Content-Type' => $type], $bytes);
        yield 'calls.list' => self::case(
            fn (MultiWA $c) => $c->calls()->list('prof-1', outcome: 'answered', followUp: 'done', from: $to, since: new DateTimeImmutable('2026-11-01T00:00:00Z'), limit: 20, cursor: 'call-9'),
            'GET', '/api/v1/calls', ['calls' => [self::CALL], 'nextCursor' => 'call-1'],
            static function (mixed $r) use ($call): void {
                self::assertInstanceOf(CallPage::class, $r);
                self::assertSame('call-1', $r->nextCursor);
                $call($r->calls[0]);
            },
            query: ['profileId' => 'prof-1', 'outcome' => 'answered', 'followUp' => 'done', 'from' => $to, 'since' => '2026-11-01T00:00:00+00:00', 'limit' => '20', 'cursor' => 'call-9'],
        );
        yield 'calls.openCount' => self::case(
            fn (MultiWA $c) => $c->calls()->openCount(),
            'GET', '/api/v1/calls/open-count', ['count' => 3],
            static fn (mixed $r) => self::assertSame(3, $r),
        );
        yield 'calls.get' => self::case(
            fn (MultiWA $c) => $c->calls()->get('call-1'),
            'GET', '/api/v1/calls/call-1', self::CALL, $call,
        );
        yield 'calls.update' => self::case(
            fn (MultiWA $c) => $c->calls()->update('call-1', followUp: 'in_progress', assignedUserId: 'user-3'),
            'PATCH', '/api/v1/calls/call-1', self::CALL, $call,
            body: ['followUp' => 'in_progress', 'assignedUserId' => 'user-3'],
        );
        yield 'calls.unassign' => self::case(
            fn (MultiWA $c) => $c->calls()->unassign('call-1'),
            'PATCH', '/api/v1/calls/call-1', self::CALL, $call,
            body: ['assignedUserId' => null],
        );
        yield 'calls.reject' => self::case(
            fn (MultiWA $c) => $c->calls()->reject('call-1'),
            'POST', '/api/v1/calls/call-1/reject', self::CALL, $call,
        );
        yield 'calls.reply' => self::case(
            fn (MultiWA $c) => $c->calls()->reply('call-1', 'We will call you back'),
            'POST', '/api/v1/calls/call-1/reply', ['call' => self::CALL, 'message' => self::SENT],
            static function (mixed $r) use ($call, $sent): void {
                self::assertIsArray($r);
                $call($r['call']);
                $sent($r['message']);
            },
            body: ['text' => 'We will call you back'],
        );
        yield 'calls.sendCallLink' => self::case(
            fn (MultiWA $c) => $c->calls()->sendCallLink('call-1', 'voice', 'Tap to call us'),
            'POST', '/api/v1/calls/call-1/call-link', ['call' => self::CALL, 'message' => self::SENT, 'link' => 'https://call.whatsapp.com/voice/AbCd'],
            static fn (mixed $r) => self::assertSame('https://call.whatsapp.com/voice/AbCd', is_array($r) ? $r['link'] : null),
            body: ['type' => 'voice', 'text' => 'Tap to call us'],
        );
        yield 'calls.mediaStatus' => self::case(
            fn (MultiWA $c) => $c->calls()->mediaStatus(),
            'GET', '/api/v1/calls/media/status',
            [
                'server' => ['enabled' => true, 'worker' => 'up', 'port' => 40000, 'engineHost' => 'api', 'activeSessions' => 0,
                    'recordings' => ['storage' => 'local', 'configured' => true, 'problem' => null, 'lastCheck' => ['at' => '2026-11-01T02:30:00.000Z', 'ok' => true]]],
                'profiles' => [self::CALLS_SETTINGS + ['name' => 'Sales', 'ready' => false, 'reasons' => ['auto_reject_on']]],
            ],
            static fn (mixed $r) => self::assertSame(['auto_reject_on'], is_array($r) ? $r['profiles'][0]['reasons'] : null),
        );
        yield 'calls.getRecording' => self::case(
            fn (MultiWA $c) => $c->calls()->getRecording('call-1', download: true),
            'GET', '/api/v1/calls/call-1/recording', [],
            static function (mixed $r): void {
                self::assertInstanceOf(AudioFile::class, $r);
                self::assertSame("\x1aE\xdf\xa3", $r->content);
                self::assertSame('audio/webm', $r->contentType);
            },
            query: ['download' => '1'],
            reply: $audio("\x1aE\xdf\xa3", 'audio/webm'),
        );
        yield 'calls.getRecording to play' => self::case(
            fn (MultiWA $c) => $c->calls()->getRecording('call-1'),
            'GET', '/api/v1/calls/call-1/recording', [],
            static fn (mixed $r) => self::assertInstanceOf(AudioFile::class, $r),
            reply: $audio("\x1aE\xdf\xa3", 'audio/webm'),
        );
        yield 'calls.deleteRecording' => self::case(
            fn (MultiWA $c) => $c->calls()->deleteRecording('call-1'),
            'DELETE', '/api/v1/calls/call-1/recording', ['callId' => 'call-1', 'recordingId' => 'rec-1', 'deletedAt' => '2026-11-02T08:00:00.000Z'],
            static fn (mixed $r) => self::assertSame('rec-1', is_array($r) ? $r['recordingId'] : null),
        );
        yield 'calls.updateSettings' => self::case(
            fn (MultiWA $c) => $c->calls()->updateSettings('prof-1', answerInDashboard: true, recording: true, retentionDays: 30),
            'PUT', '/api/v1/profiles/prof-1/calls-settings', self::CALLS_SETTINGS,
            static function (mixed $r): void {
                self::assertInstanceOf(CallsSettings::class, $r);
                self::assertSame(30, $r->retentionDays);
                self::assertSame(['mimeType' => 'audio/mpeg', 'durationSec' => 6.2], $r->announcement);
            },
            body: ['answerInDashboard' => true, 'recording' => true, 'retentionDays' => 30],
        );
        yield 'calls.uploadAnnouncement' => self::case(
            fn (MultiWA $c) => $c->calls()->uploadAnnouncement('prof-1', "ID3\x04", 'notice.mp3'),
            'POST', '/api/v1/profiles/prof-1/calls-announcement', ['profileId' => 'prof-1', 'announcement' => ['mimeType' => 'audio/mpeg', 'durationSec' => 6.2]],
            static fn (mixed $r) => self::assertSame('audio/mpeg', is_array($r) ? $r['announcement']['mimeType'] ?? null : null),
            multipart: ['file' => ['notice.mp3', "ID3\x04"]],
        );
        yield 'calls.getAnnouncement' => self::case(
            fn (MultiWA $c) => $c->calls()->getAnnouncement('prof-1'),
            'GET', '/api/v1/profiles/prof-1/calls-announcement', [],
            static function (mixed $r): void {
                self::assertInstanceOf(AudioFile::class, $r);
                self::assertSame('audio/mpeg', $r->contentType);
            },
            reply: $audio("ID3\x04", 'audio/mpeg'),
        );
        yield 'calls.deleteAnnouncement' => self::case(
            fn (MultiWA $c) => $c->calls()->deleteAnnouncement('prof-1'),
            'DELETE', '/api/v1/profiles/prof-1/calls-announcement', ['profileId' => 'prof-1', 'announcement' => null],
            static fn (mixed $r) => self::assertSame(['profileId' => 'prof-1', 'announcement' => null], $r),
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
            'calls' => CallsClient::class,
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

    public function testReplyWithoutATextSendsAnEmptyObject(): void
    {
        $client = $this->client([new Response(201, [], json_encode(['call' => self::CALL, 'message' => self::SENT], JSON_THROW_ON_ERROR))]);

        $client->calls()->reply('call-1'); // the profile's default call reply

        self::assertSame('{}', (string) $this->onlyRequest()->getBody());
    }

    /**
     * The file uploaded, made from the path of a file notice.mp3 that holds the audio; the filename given (null: none);
     * the filename it goes out under.
     *
     * @return iterable<string, array{\Closure(string): mixed, string|null, string}>
     */
    public static function announcements(): iterable
    {
        $bytes = static fn (string $path): string => self::AUDIO;
        $file = static fn (string $path): mixed => fopen($path, 'rb');
        $memory = static function (string $path): mixed {
            $stream = fopen('php://memory', 'w+b');
            self::assertIsResource($stream);
            fwrite($stream, self::AUDIO);
            rewind($stream);

            return $stream;
        };

        yield 'bytes' => [$bytes, null, 'announcement'];
        yield 'bytes, named' => [$bytes, 'greeting.mp3', 'greeting.mp3'];
        yield 'bytes, an empty name counts as none' => [$bytes, '', 'announcement'];
        yield "a file's stream keeps the file's name" => [$file, null, 'notice.mp3'];
        yield "a file's stream, named: the name given wins" => [$file, 'greeting.mp3', 'greeting.mp3'];
        yield "a file's stream, an empty name counts as none" => [$file, '', 'notice.mp3'];
        yield 'a stream of no file' => [$memory, null, 'announcement'];
    }

    /**
     * @param \Closure(string): mixed $file
     */
    #[DataProvider('announcements')]
    public function testAnnouncementGoesOutAsExactlyItsBytes(\Closure $file, ?string $filename, string $sentAs): void
    {
        $dir = sys_get_temp_dir() . '/multiwa-' . bin2hex(random_bytes(6));
        mkdir($dir);
        $path = "{$dir}/notice.mp3";
        file_put_contents($path, self::AUDIO);
        $client = $this->client([new Response(201, [], json_encode(['profileId' => 'prof-1', 'announcement' => null], JSON_THROW_ON_ERROR))]);

        try {
            $filename === null
                ? $client->calls()->uploadAnnouncement('prof-1', $file($path))
                : $client->calls()->uploadAnnouncement('prof-1', $file($path), $filename);

            self::assertSame(['file' => [$sentAs, self::AUDIO]], self::parts($this->onlyRequest()));
        } finally {
            unlink($path);
            rmdir($dir);
        }
    }

    public function testUploadLeavesTheCallersFileOpen(): void
    {
        $file = self::audioFile();
        $client = $this->client([new Response(201, [], json_encode(['profileId' => 'prof-1', 'announcement' => null], JSON_THROW_ON_ERROR))]);

        $client->calls()->uploadAnnouncement('prof-1', $file);
        // Nothing holds the request any more, as after a real handler: here the client's mock keeps its last request.
        unset($client);
        $this->history = [];
        gc_collect_cycles();

        // Still an open stream (a closed one is of type Unknown), for the caller to close.
        self::assertSame('stream', get_resource_type($file));
        self::assertTrue(fclose($file));
    }

    public function testRetryWithTheSameFileSendsItWhole(): void
    {
        $file = self::audioFile();
        $client = $this->client([new Response(503, [], json_encode(['statusCode' => 503, 'message' => 'Service Unavailable'], JSON_THROW_ON_ERROR))]);
        try {
            $client->calls()->uploadAnnouncement('prof-1', $file, 'notice.mp3');
            self::fail('No exception was thrown');
        } catch (ApiException $e) {
            self::assertSame(503, $e->getStatusCode());
        }
        // Nothing holds the first request any more, as after a real handler: here the client's mock keeps its last
        // request, and the exception's trace the options it was sent with.
        unset($client, $e);
        $this->history = [];
        gc_collect_cycles();

        $client = $this->client([new Response(201, [], json_encode(['profileId' => 'prof-1', 'announcement' => null], JSON_THROW_ON_ERROR))]);
        $client->calls()->uploadAnnouncement('prof-1', $file, 'notice.mp3');

        self::assertSame(['file' => ['notice.mp3', self::AUDIO]], self::parts($this->onlyRequest()));
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
     * @param ResponseInterface|null             $reply     the answer, when it is not $response as JSON
     * @param array<string, array{string, string}>|null $multipart name => [filename, contents] of an upload
     *
     * @return array{\Closure, string, string, array<string, string|list<string>>, array<mixed>|null, array<mixed>, \Closure, ResponseInterface|null, array<string, array{string, string}>|null}
     */
    private static function case(\Closure $call, string $method, string $path, array $response, \Closure $check, array $query = [], ?array $body = null, ?ResponseInterface $reply = null, ?array $multipart = null): array
    {
        ksort($query);

        return [$call, $method, $path, $query, $body, $response, $check, $reply, $multipart];
    }

    /**
     * An open file of the audio, at its start; deleted once closed.
     *
     * @return resource
     */
    private static function audioFile(): mixed
    {
        $file = tmpfile();
        self::assertIsResource($file);
        fwrite($file, self::AUDIO);
        rewind($file);

        return $file;
    }

    /**
     * A multipart body's parts: name => [filename, the exact bytes sent].
     *
     * @return array<string, array{string|null, string}>
     */
    private static function parts(RequestInterface $request): array
    {
        $boundary = explode('boundary=', $request->getHeaderLine('Content-Type'), 2)[1] ?? '';
        $chunks = explode("--{$boundary}", (string) $request->getBody());
        // Nothing before the first boundary, and nothing after the last.
        self::assertSame('', array_shift($chunks));
        self::assertSame("--\r\n", array_pop($chunks));
        $parts = [];
        foreach ($chunks as $chunk) {
            [$head, $content] = explode("\r\n\r\n", $chunk, 2) + ['', ''];
            self::assertSame(1, preg_match('/^Content-Disposition: form-data; name="([^"]*)"(?:; filename="([^"]*)")?\r?$/m', $head, $disposition));
            self::assertStringEndsWith("\r\n", $content);
            $parts[$disposition[1]] = [$disposition[2] ?? null, substr($content, 0, -2)];
        }

        return $parts;
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
