// The signed-in user as the login stored it (localStorage), for what the UI shows: the API checks every action itself.
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId?: string;
}

export function currentUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem('user') ?? 'null');
  } catch {
    return null;
  }
}

/** Owner, admin and member answer calls; a viewer does not. */
export const canAnswerCalls = (role?: string) => role === 'owner' || role === 'admin' || role === 'member';

/** Owner and admin manage a profile's calls settings and its recordings. */
export const canManageCalls = (role?: string) => role === 'owner' || role === 'admin';
