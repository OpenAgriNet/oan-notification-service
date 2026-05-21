import { NotificationType } from '../enums/notification-type.enum';

const WEATHER_PATTERNS =
  /rain|bv|bin|precip|cyclone|flood|storm|thunder|wind|humid|temp|heat|cold|fog|frost|drizzle|monsoon|season|kharif|rabi|onset|withdrawal/i;

export function classifyNotification(templateAbbreviation: string | null): NotificationType {
  if (templateAbbreviation && WEATHER_PATTERNS.test(templateAbbreviation)) {
    return NotificationType.WEATHER_ADVISORY;
  }
  return NotificationType.GENERAL;
}
