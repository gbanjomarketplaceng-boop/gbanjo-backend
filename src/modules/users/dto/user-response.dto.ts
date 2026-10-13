import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import type { User } from "../../../generated/prisma/client";

/** Public view of a user. Never includes the password hash. */
export class UserResponseDto {
  @ApiProperty({ example: "cmg2x0f1x0000a8s1b2c3d4e5" }) id!: string;
  @ApiProperty({ example: "Romina" }) firstName!: string;
  @ApiProperty({ example: "Williams" }) lastName!: string;
  @ApiProperty({ example: "romina.williams@email.com" }) email!: string;
  @ApiPropertyOptional({ example: "+2349045654356", nullable: true, type: String, description: "Null for a Google/Apple account that hasn't added one yet" }) phone!: string | null;
  @ApiPropertyOptional({ example: null, nullable: true, type: String }) avatarUrl!: string | null;
  @ApiProperty({ enum: ["USER", "ADMIN"] }) role!: "USER" | "ADMIN";
  @ApiProperty({ description: "Phone number confirmed with an SMS code" }) isPhoneVerified!: boolean;
  @ApiProperty() isEmailVerified!: boolean;
  @ApiProperty({ description: "False until the user creates a password (mobile sign-up)" }) hasPassword!: boolean;
  @ApiProperty({ description: "First name, last name and phone are all filled in" }) isProfileComplete!: boolean;
  @ApiProperty() createdAt!: Date;

  static isProfileComplete(user: Pick<User, "firstName" | "lastName" | "phone">) {
    return !!user.firstName.trim() && !!user.lastName.trim() && !!user.phone;
  }

  static from(user: User): UserResponseDto {
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      role: user.role,
      isPhoneVerified: !!user.phoneVerifiedAt,
      isEmailVerified: !!user.emailVerifiedAt,
      hasPassword: !!user.passwordHash,
      isProfileComplete: UserResponseDto.isProfileComplete(user),
      createdAt: user.createdAt,
    };
  }
}
