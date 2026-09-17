import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const weatherPreferences = sqliteTable("weather_preferences", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
