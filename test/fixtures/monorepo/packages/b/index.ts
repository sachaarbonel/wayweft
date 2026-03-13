export function access(user: { profile?: { name: string } } | null) {
  return user == null ? undefined : user.profile?.name;
}
