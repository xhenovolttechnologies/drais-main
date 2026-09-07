import { NextRequest, NextResponse } from 'next/server';
import { sendSMS, logSMSActivity } from '@/lib/africastalking';
import { getSessionSchoolId } from '@/lib/auth';
import { getCommSettings } from '@/lib/comm/settings';
import { logAudit, AuditAction } from '@/lib/audit';
import { getSchoolSmsPosition, getProviderBalanceCached, getSmsPricing } from '@/lib/control/sms-economics';

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionSchoolId(req);
    if (!session) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const { phone, message, recipient_name, short_code } = body;

    // Validate input
    if (!phone || !message) {
      return NextResponse.json({
        success: false,
        error: 'Phone number and message are required'
      }, { status: 400 });
    }

    // Validate message length
    if (message.trim().length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Message cannot be empty'
      }, { status: 400 });
    }

    if (message.length > 480) { // Allow up to 3 SMS
      return NextResponse.json({
        success: false,
        error: 'Message is too long (max 480 characters)'
      }, { status: 400 });
    }

    // Per-school provider credentials (settings → env fallback).
    const cs = await getCommSettings(session.schoolId).catch(() => null);
    if (cs && !cs.smsEnabled) {
      return NextResponse.json({ success: false, error: 'SMS is disabled for this school by the platform administrator.' }, { status: 403 });
    }

    // P5 allocation enforcement: a school can't consume beyond its SMS quota
    // (uncapped when no allocation is set). Prevents one school burning another's.
    const pos = await getSchoolSmsPosition(session.schoolId).catch(() => null);
    if (pos && pos.quota != null && pos.remaining <= 0) {
      return NextResponse.json({
        success: false,
        error: `SMS allocation exhausted (${pos.used}/${pos.quota} used). Ask the platform administrator to top up this school's allocation.`,
        code: 'SMS_QUOTA_EXCEEDED',
      }, { status: 403 });
    }

    // Money enforcement: if the platform provider balance can't cover even one
    // SMS, block LOUDLY (never let a send fail silently downstream).
    const bal = await getProviderBalanceCached().catch(() => null);
    const pricing = await getSmsPricing();
    if (bal && bal.ok && bal.amount < pricing.internalCost) {
      return NextResponse.json({
        success: false,
        error: 'The platform SMS balance is depleted — messages cannot be sent until the administrator tops up the SMS account.',
        code: 'SMS_BALANCE_DEPLETED',
      }, { status: 503 });
    }
    // Sender ID is OPTIONAL and never forced: use the explicit short_code from
    // the request, else the school's configured sender_id (only if set). If
    // neither is present we pass nothing and Africa's Talking uses its default
    // sender — required for accounts without a registered alphanumeric ID.
    const effectiveSender = short_code || cs?.senderName || undefined;
    const smsResult = await sendSMS(
      phone,
      message,
      recipient_name,
      effectiveSender,
      { username: cs?.providerUsername, apiKey: cs?.providerApiKey },
    );

    // Log activity
    await logSMSActivity(
      phone,
      message,
      smsResult.success ? 'sent' : 'failed',
      recipient_name,
      smsResult.messageId
    );

    // Accountability (P2) + usage foundation (P5): who sent what, to whom, how
    // many segments, at what cost.
    void logAudit({
      schoolId: session.schoolId, userId: (session as any).userId ?? null,
      action: AuditAction.SMS_SENT, entityType: 'sms',
      details: {
        recipient: phone, recipient_name: recipient_name || null,
        segments: Math.max(1, Math.ceil((message?.length || 0) / 160)),
        length: message?.length || 0, success: smsResult.success,
        message_id: smsResult.messageId || null, cost: smsResult.cost ?? null,
      },
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null,
      userAgent: req.headers.get('user-agent'),
    });

    if (smsResult.success) {
      return NextResponse.json({
        success: true,
        message: `SMS sent successfully to ${recipient_name || phone}`,
        data: {
          messageId: smsResult.messageId,
          status: smsResult.status,
          cost: smsResult.cost,
          phone: smsResult.phone,
          recipientName: smsResult.recipientName,
          sentAt: smsResult.details?.sentAt
        }
      });
    } else {
      return NextResponse.json({
        success: false,
        error: smsResult.error || 'Failed to send SMS'
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('SMS API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to process SMS request'
    }, { status: 500 });
  }
}
