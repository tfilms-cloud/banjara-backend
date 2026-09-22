export type UserRole = 'customer' | 'provider' | 'admin';
export type UserStatus = 'active' | 'inactive' | 'suspended';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  role: UserRole;
  email: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  role?: UserRole;
}

export interface LoginInput {
  email: string;
  password: string;
}
