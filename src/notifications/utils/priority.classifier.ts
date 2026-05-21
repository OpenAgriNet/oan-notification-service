import { NotificationType } from '../enums/notification-type.enum';
import { Priority } from '../enums/priority.enum';

// Priority rules per notification type.
// WEATHER_ADVISORY is HIGH — directly impacts farmer decisions.
// GENERAL is LOW — informational, no immediate action required.
const TYPE_PRIORITY: Record<NotificationType, Priority> = {
  [NotificationType.WEATHER_ADVISORY]: Priority.HIGH,
  [NotificationType.GENERAL]:          Priority.LOW,
};

export function derivePriority(type: NotificationType): Priority {
  return TYPE_PRIORITY[type] ?? Priority.LOW;
}
