// MultiWA Gateway - Global Audit Interceptor
// Automatically logs all mutating API requests (POST, PUT, DELETE) to audit log

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { AuditService, AuditAction } from './audit.service';

// Map controller + method to audit action
const ACTION_MAP: Record<string, AuditAction | string> = {
  // Auth
  'AuthController.login': AuditAction.LOGIN,
  'AuthController.register': 'auth.register',
  
  // Profiles
  'ProfilesController.create': AuditAction.PROFILE_CREATE,
  'ProfilesController.update': AuditAction.PROFILE_UPDATE,
  'ProfilesController.delete': AuditAction.PROFILE_DELETE,
  'ProfilesController.connect': AuditAction.PROFILE_CONNECT,
  'ProfilesController.disconnect': AuditAction.PROFILE_DISCONNECT,
  
  // Messages
  'MessagesController.send': AuditAction.MESSAGE_SEND,
  
  // Broadcast
  'BroadcastController.create': AuditAction.BROADCAST_CREATE,
  'BroadcastController.start': AuditAction.BROADCAST_START,
  'BroadcastController.delete': AuditAction.BROADCAST_DELETE,
  
  // Automation
  'AutomationController.create': AuditAction.AUTOMATION_CREATE,
  'AutomationController.update': AuditAction.AUTOMATION_UPDATE,
  'AutomationController.delete': AuditAction.AUTOMATION_DELETE,
  'AutomationController.toggle': AuditAction.AUTOMATION_TOGGLE,
  
  // Contacts
  'ContactsController.create': 'contact.create',
  'ContactsController.update': 'contact.update',
  'ContactsController.delete': AuditAction.CONTACT_DELETE,
  'ContactsController.import': AuditAction.CONTACT_IMPORT,
  'ContactsController.importCsv': AuditAction.CONTACT_IMPORT,
  'ContactsController.exportCsv': AuditAction.CONTACT_EXPORT,
  'ContactsController.syncFromWhatsApp': 'contact.sync',
  
  // API Keys
  'ApiKeysController.create': AuditAction.APIKEY_CREATE,
  'ApiKeysController.revoke': AuditAction.APIKEY_REVOKE,
  
  // Webhooks
  'WebhooksController.create': AuditAction.WEBHOOK_CREATE,
  'WebhooksController.update': AuditAction.WEBHOOK_UPDATE,
  'WebhooksController.delete': AuditAction.WEBHOOK_DELETE,
  
  // Templates
  'TemplatesController.create': 'template.create',
  'TemplatesController.update': 'template.update',
  'TemplatesController.delete': 'template.delete',
  'TemplatesController.duplicate': 'template.duplicate',
  
  // Conversations
  'ConversationsController.archive': 'conversation.archive',
  'ConversationsController.clearMessages': 'conversation.clear',
  'ConversationsController.delete': 'conversation.delete',
  'ConversationsController.toggleMute': 'conversation.mute',
  'ConversationsController.togglePin': 'conversation.pin',
  
  // Settings
  'SettingsController.update': AuditAction.SETTINGS_UPDATE,
  
  // Groups
  'GroupsController.create': 'group.create',
  'GroupsController.updateName': 'group.update',
  'GroupsController.updateDescription': 'group.update',
  'GroupsController.addParticipants': 'group.add_participant',
  'GroupsController.removeParticipants': 'group.remove_participant',
  'GroupsController.leave': 'group.leave',
  
  // RBAC
  'RbacController.assignRole': 'user.role_change',
  'RbacController.removeRole': 'user.role_change',
  'RbacController.inviteMember': AuditAction.USER_INVITE,
  'RbacController.removeMember': AuditAction.USER_REMOVE,

  // Bulk
  'BulkController.send': AuditAction.MESSAGE_BULK_SEND,
};

// Controllers/methods to skip (read-only, high-frequency, or internal)
const SKIP_PATTERNS = [
  /\.findAll$/,
  /\.findOne$/,
  /\.getStats$/,
  /\.status$/,
  /\.me$/,
  /\.query$/,    // audit query itself
  /\.getSummary$/,
  /\.getActions$/,
  /^StatisticsController\./,
  /^UploadsController\./,
];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditInterceptor');

  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    
    // Only audit mutating requests
    if (method === 'GET') return next.handle();
    
    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;
    const key = `${controllerName}.${handlerName}`;
    
    // Skip if matches skip pattern
    if (SKIP_PATTERNS.some(p => p.test(key))) return next.handle();
    
    // Determine audit action
    const action = ACTION_MAP[key] || `${controllerName.replace('Controller', '').toLowerCase()}.${handlerName}`;
    
    // Extract resource info
    const params = req.params || {};
    const body = req.body || {};
    const resourceType = controllerName.replace('Controller', '').toLowerCase();
    const resourceId = params.id || body.id || body.profileId || undefined;
    
    // Build metadata (exclude sensitive data)
    const metadata: Record<string, any> = {};
    if (body.name) metadata.name = body.name;
    if (body.to) metadata.to = body.to;
    if (body.type) metadata.type = body.type;
    if (body.profileId) metadata.profileId = body.profileId;
    if (body.triggerType) metadata.triggerType = body.triggerType;
    if (params.id) metadata.targetId = params.id;
    
    // User info
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    const ip = req.ip || req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'];
    const userAgent = req.headers?.['user-agent'];
    
    return next.handle().pipe(
      tap((response) => {
        // Log successful action (fire-and-forget)
        this.auditService.log({
          action,
          userId,
          organizationId,
          resourceType,
          resourceId,
          metadata: { ...metadata, status: 'success' },
          ip,
          userAgent,
        }).catch(err => {
          this.logger.warn(`Failed to log audit: ${err.message}`);
        });
      }),
      catchError((error) => {
        // Log failed action for auth-related events
        if (action.startsWith('auth.')) {
          this.auditService.log({
            action: action === AuditAction.LOGIN ? AuditAction.LOGIN_FAILED : action,
            userId,
            organizationId,
            resourceType,
            metadata: { ...metadata, status: 'failed', error: error.message },
            ip,
            userAgent,
          }).catch(err => {
            this.logger.warn(`Failed to log audit: ${err.message}`);
          });
        }
        return throwError(() => error);
      }),
    );
  }
}
