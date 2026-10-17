-- AirSense IoT - ตั้งค่าฐานข้อมูลบน Supabase
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run

-- 1) ตารางอุปกรณ์
create table if not exists devices (
  id          bigint generated always as identity primary key,
  device_code text unique not null,
  name        text,
  location    text,
  created_at  timestamptz default now()
);

-- 2) ตารางค่าที่วัดได้
create table if not exists readings (
  id          bigint generated always as identity primary key,
  device_code text not null references devices(device_code),
  pm25        numeric(6,2) not null check (pm25 >= 0 and pm25 <= 1000),
  humidity    numeric(5,2) check (humidity >= 0 and humidity <= 100),
  recorded_at timestamptz not null default now()
);

create index if not exists idx_readings_dev_time
  on readings (device_code, recorded_at desc);

-- 3) อุปกรณ์ตัวอย่าง
insert into devices (device_code, name, location)
values ('IoT-01', 'Home sensor · Lampang', 'Lampang, Thailand')
on conflict (device_code) do nothing;

-- 4) สิทธิ์การเข้าถึง (Row Level Security)
alter table devices  enable row level security;
alter table readings enable row level security;

drop policy if exists "read devices"   on devices;
drop policy if exists "read readings"  on readings;
drop policy if exists "insert readings" on readings;

create policy "read devices"    on devices  for select using (true);
create policy "read readings"   on readings for select using (true);
-- เปิดให้ใครก็เพิ่มข้อมูลได้ (เหมาะกับช่วงทดลองกับตัวจำลองเท่านั้น)
create policy "insert readings" on readings for insert with check (true);

-- 5) (ทางเลือก) ลบข้อมูลเก่าเกิน 7 วัน ไม่ให้ตารางโตเกินไป
-- รันด้วยมือเป็นครั้งคราว หรือตั้ง pg_cron ภายหลัง
-- delete from readings where recorded_at < now() - interval '7 days';
