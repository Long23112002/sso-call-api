# Cách test auto-update trên Mac

## Bước 1: Cài bản “cũ” lên Mac (để sau đó nhận bản mới)

Chọn một trong hai:

**Cách A – Build bản cũ ngay trên Mac:**
1. Trong `package.json` đặt `"version": "1.0.0"` (hoặc bản thấp hơn bản sẽ release).
2. Chạy: `npm install` rồi `npm run build:mac`.
3. Mở file `.dmg` trong thư mục `dist/` và kéo app vào Applications (cài như bình thường).
4. Đổi lại `package.json` về version cao hơn (ví dụ `1.0.2`) rồi commit (chưa cần push tag).

**Cách B – Dùng bản đã có trên Releases:**
- Nếu đã từng push tag (ví dụ `v1.0.2`) và workflow Mac đã chạy, vào [Releases](https://github.com/Long23112002/sso-call-api/releases), tải file `.dmg` của bản đó và cài lên Mac. Sau đó dùng bản mới hơn (ví dụ `v1.0.3`) để test.

## Bước 2: Đẩy bản mới lên GitHub Releases (có cả bản Mac)

1. Trong `package.json` đặt version mới, ví dụ `"version": "1.0.2"`.
2. Commit và push:
   ```bash
   git add package.json && git commit -m "Bump 1.0.2" && git push origin main
   ```
3. Tạo tag và push để trigger build **Windows + Mac** và publish:
   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   ```
4. Vào [Actions](https://github.com/Long23112002/sso-call-api/actions): đợi cả workflow **Build Windows** và **Build Mac** chạy xanh. Sau đó vào [Releases](https://github.com/Long23112002/sso-call-api/releases): bản v1.0.2 sẽ có cả file Windows và file **.dmg** (Mac).

**Nếu release v1.0.2 chưa có file .dmg (chỉ có file Windows):**  
Vào [Actions](https://github.com/Long23112002/sso-call-api/actions) → chọn workflow **"Build Mac"** → **Run workflow** → **Run workflow** (branch: main). Đợi job chạy xong, bản Mac sẽ được đẩy vào đúng release v1.0.2 và app trên Mac mới thấy bản cập nhật.

## Bước 3: Test update trên Mac

1. Mở app bản cũ đã cài (ví dụ 1.0.0) trên Mac.
2. Đợi khoảng **5–10 giây** (app tự gọi kiểm tra bản mới).
3. Nếu có bản mới (ví dụ 1.0.2) trên Releases có kèm bản Mac:
   - Banner xanh phía trên: “Đang tải bản cập nhật v1.0.2...”.
   - Khi tải xong sẽ có hộp thoại: “Đã tải xong phiên bản 1.0.2. Khởi động lại ứng dụng để cập nhật?”.
4. Chọn **“Khởi động lại ngay”** → app sẽ cài bản mới và mở lại.

**Lưu ý:** Auto-update chỉ chạy trên **app đã build (đã cài từ .dmg)**, không chạy khi mở bằng `npm start`.
