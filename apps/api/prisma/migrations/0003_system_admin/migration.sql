-- حساب المدير الأساسي (admin): لا يُحذف ولا يُعطّل ولا يُخفّض دوره. طلب صاحب المشروع، 26 أكتوبر 2026

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_system_account" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "username" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");


-- ---------------------------------------------------------------------------
-- حماية حساب النظام على مستوى قاعدة البيانات (لا يعتمد على التطبيق وحده)
-- المسموح: تعديل البريد، كلمة المرور، اللغة، أوقات الدخول وقفل المحاولات الفاشلة.
-- الممنوع: الحذف (نهائي أو ناعم)، تغيير الدور، التعطيل أو الإيقاف، تغيير اسم الدخول، إلغاء صفة حساب النظام.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_system_account() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system_account THEN
      RAISE EXCEPTION 'System account % cannot be deleted', OLD.username USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system_account AND (
       NEW.is_system_account IS DISTINCT FROM TRUE
    OR NEW.deleted_at IS NOT NULL
    OR NEW.role IS DISTINCT FROM 'SUPER_ADMIN'
    OR NEW.status IS DISTINCT FROM 'ACTIVE'
    OR NEW.username IS DISTINCT FROM OLD.username
  ) THEN
    RAISE EXCEPTION 'System account % cannot be deleted, disabled, demoted or renamed', OLD.username USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_protect_system_account
  BEFORE UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION protect_system_account();

-- TRUNCATE يتجاوز مشغّلات الصفوف، فيُمنع على جدول المستخدمين كاملاً.
CREATE OR REPLACE FUNCTION forbid_users_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE on users is not allowed' USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_forbid_truncate
  BEFORE TRUNCATE ON "users"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_users_truncate();
