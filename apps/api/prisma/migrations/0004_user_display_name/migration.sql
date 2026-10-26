-- اسم العرض لحسابات المدراء (الدفعة 4: إنشاء مدير بالاسم). عمود اختياري، لا يمس البيانات القائمة.
ALTER TABLE "users" ADD COLUMN "display_name" VARCHAR(200);
