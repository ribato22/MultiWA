// MultiWA Gateway API - JWT Strategy
// apps/api/src/modules/auth/strategies/jwt.strategy.ts

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@multiwa/database';
import { SessionsService } from '../sessions.service';

export interface JwtPayload {
  sub: string;
  email: string;
  organizationId: string;
  role: string;
}

const extractToken = ExtractJwt.fromAuthHeaderAsBearerToken();

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // getOrThrow -> string (passport-jwt 4 types now reject string | undefined);
      // JWT_SECRET is already fail-fast validated at boot in main.ts.
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload) {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { organization: true },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }

    // Enforce revocation: the access token must still map to a live session, so
    // logout / revoke-session / revoke-all actually invalidate the JWT rather
    // than leaving it valid until its natural expiry.
    const token = extractToken(req);
    if (!token || !(await this.sessions.validateAndTouch(token))) {
      throw new UnauthorizedException('Session expired or revoked');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization,
    };
  }
}
