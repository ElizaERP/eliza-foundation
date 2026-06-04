/**
 * UserStatus — ciclo de vida del usuario en ELIZA.
 *
 *   Pending ──activate──▶ Active ──suspend──▶ Suspended ──reactivate──▶ Active
 *     │                     │                     │
 *     └──delete──▶ Deleted  └──delete──▶ Deleted  └──delete──▶ Deleted (terminal)
 */
export enum UserStatus {
  Pending = 'Pending',
  Active = 'Active',
  Suspended = 'Suspended',
  Deleted = 'Deleted',
}

export const USER_STATUS_TRANSITIONS: Readonly<Record<UserStatus, ReadonlyArray<UserStatus>>> = Object.freeze({
  [UserStatus.Pending]:   [UserStatus.Active, UserStatus.Deleted],
  [UserStatus.Active]:    [UserStatus.Suspended, UserStatus.Deleted],
  [UserStatus.Suspended]: [UserStatus.Active, UserStatus.Deleted],
  [UserStatus.Deleted]:   [],
});

export function canUserTransition(from: UserStatus, to: UserStatus): boolean {
  return USER_STATUS_TRANSITIONS[from].includes(to);
}
