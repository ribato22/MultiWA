// MultiWA Gateway API - Notifications Controller
// apps/api/src/modules/notifications/notifications.controller.ts

import { Controller, Get, Post, Patch, Delete, Param, Query, Body, UseGuards, Request, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { PushService, PushSubscriptionPayload } from './push.service';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get notifications for the current user' })
  @ApiQuery({ name: 'unread', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Notifications list' })
  async getAll(
    @Request() req: any,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.notificationsService.getAll(req.user.id, {
      unreadOnly: unread === 'true',
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  @ApiResponse({ status: 200, description: 'Unread count' })
  async getUnreadCount(@Request() req: any) {
    const count = await this.notificationsService.getUnreadCount(req.user.id);
    return { count };
  }

  // =============================
  // Push Notification Endpoints
  // =============================

  @Get('push/vapid-key')
  @ApiOperation({ summary: 'Get VAPID public key for push subscriptions' })
  @ApiResponse({ status: 200, description: 'VAPID public key' })
  async getVapidPublicKey() {
    const publicKey = await this.pushService.getVapidPublicKey();
    return { publicKey };
  }

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'Get push subscriptions for current user' })
  @ApiResponse({ status: 200, description: 'List of push subscriptions' })
  async getSubscriptions(@Request() req: any) {
    const subscriptions = await this.pushService.getSubscriptions(req.user.id);
    const hasSubscription = subscriptions.length > 0;
    return { subscriptions, hasSubscription };
  }

  @Post('push/subscribe')
  @ApiOperation({ summary: 'Subscribe to push notifications' })
  @ApiResponse({ status: 201, description: 'Subscription saved' })
  async subscribePush(
    @Request() req: any,
    @Body() body: PushSubscriptionPayload,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.pushService.subscribe(req.user.id, body, userAgent);
    return { success: true, message: 'Push subscription saved' };
  }

  @Post('push/unsubscribe')
  @ApiOperation({ summary: 'Unsubscribe from push notifications' })
  @ApiResponse({ status: 200, description: 'Subscription removed' })
  async unsubscribePush(
    @Request() req: any,
    @Body() body: { endpoint: string },
  ) {
    await this.pushService.unsubscribe(req.user.id, body.endpoint);
    return { success: true, message: 'Push subscription removed' };
  }

  @Post('push/test')
  @ApiOperation({ summary: 'Send a test push notification with diagnostics' })
  @ApiResponse({ status: 200, description: 'Test push sent with diagnostics' })
  async testPush(@Request() req: any) {
    const diagnostics = await this.pushService.sendPushWithDiagnostics(
      req.user.id,
      'Test Notification',
      'Push notifications are working! 🎉',
      { type: 'test' },
    );
    return diagnostics;
  }

  // =============================
  // Existing endpoints
  // =============================

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(@Param('id') id: string, @Request() req: any) {
    await this.notificationsService.markAsRead(id, req.user.id);
    return { success: true };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  async markAllAsRead(@Request() req: any) {
    await this.notificationsService.markAllAsRead(req.user.id);
    return { success: true };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiResponse({ status: 200, description: 'Notification deleted' })
  async deleteOne(@Param('id') id: string, @Request() req: any) {
    await this.notificationsService.delete(id, req.user.id);
    return { success: true };
  }

  @Delete()
  @ApiOperation({ summary: 'Clear all notifications' })
  @ApiResponse({ status: 200, description: 'All notifications cleared' })
  async clearAll(@Request() req: any) {
    await this.notificationsService.clearAll(req.user.id);
    return { success: true };
  }
}
