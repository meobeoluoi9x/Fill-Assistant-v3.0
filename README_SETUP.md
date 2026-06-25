# Fill Assistant PWA - bản đã nhập dữ liệu ngày 25

Bản này đã nhúng dữ liệu từ file Excel thực tế bạn gửi:

- Cấu hình máy/slot/sản phẩm
- Tồn cabin ban đầu
- Nhật ký fill ngày 25
- Nhật ký NCC thực nhận ngày 25

Khi mở app lần đầu, dữ liệu ngày 25 sẽ có sẵn. Nếu trước đó bạn đã mở bản cũ trên cùng trình duyệt, hãy vào Cài đặt trong app và bấm Reset để nạp lại dữ liệu nhúng mới.

# Fill Assistant PWA tạm thời

Bản này chạy được ngay, không cần server, không cần domain, không cần Google Sheets.

## Cách chạy thử trên máy tính

1. Giải nén file ZIP.
2. Mở thư mục `fill_assistant_pwa_v0`.
3. Chạy bằng một local server.

Nếu có Python:
```bash
python -m http.server 8080
```

Sau đó mở:
```text
http://localhost:8080
```

Không nên mở trực tiếp bằng cách double click `index.html` vì PWA/service worker cần chạy qua http/https.

## Cách đưa lên điện thoại miễn phí

Cách dễ nhất: dùng GitHub Pages hoặc Netlify.

### GitHub Pages
1. Tạo tài khoản GitHub.
2. Tạo repository mới, ví dụ `fill-assistant`.
3. Upload toàn bộ file trong thư mục này lên repository.
4. Vào Settings → Pages.
5. Source chọn `Deploy from a branch`.
6. Branch chọn `main`, folder `/root`.
7. Lưu lại.
8. GitHub sẽ cho link dạng:
```text
https://ten-cua-ban.github.io/fill-assistant/
```

### Cài lên Android
1. Mở link bằng Chrome.
2. Bấm menu 3 chấm.
3. Chọn `Add to Home screen` hoặc `Install app`.

### Cài lên iPhone
1. Mở link bằng Safari.
2. Bấm nút Share.
3. Chọn `Add to Home Screen`.

## Cách dùng

Chỉ nhập ở 2 màn hình:

### 1. Nhập Fill
- Ngày
- Máy
- Slot
- Số lượng đã fill

### 2. Nhập NCC
- Ngày
- Máy
- Sản phẩm
- Số lượng thực nhận

## Công thức logic

Tồn cabin hiện tại:
```text
Tồn cabin ban đầu + NCC thực nhận - Đã fill vào máy
```

Không quản lý số đã đặt, vì NCC có thể giao thiếu.

## Chỉnh dữ liệu thật

Mở file:
```text
data.js
```

Sửa:
- Danh sách máy
- Slot
- Sản phẩm
- Sức chứa
- Tồn cabin ban đầu

## Sao lưu

Trong app có nút:
- Xuất dữ liệu JSON
- Nhập dữ liệu JSON

Nên xuất backup cuối ngày để tránh mất dữ liệu.


## Cập nhật bản này

### Quy tắc đặt NCC mới

- Sản phẩm thường:
  - Tồn cabin > 12: gợi ý đặt 1 quy cách.
  - Tồn cabin <= 12: gợi ý đặt 2 quy cách.
- Aqua / Aquafina:
  - Tồn cabin >= 28: gợi ý đặt 2 quy cách.
  - Tồn cabin < 28: gợi ý đặt 3 quy cách.

Lưu ý: "Gợi ý đặt NCC" không tự cộng vào tồn. Chỉ số lượng nhập ở màn hình "Nhập NCC thực nhận" mới cộng vào tồn cabin.

### Sửa / Xóa / Hoàn tác

Trong lịch sử Fill và lịch sử NCC:
- Bấm `Sửa` để đưa dữ liệu lên form và cập nhật.
- Bấm `Xóa` để xóa dòng.
- Sau khi sửa hoặc xóa có thể bấm `Hoàn tác` trong vài giây.



## Bản V2 - Điều chỉnh cabin

Đã thêm màn hình `Điều chỉnh`.

Dùng khi tồn cabin thực tế bị lệch so với app.

Công thức mới:

```text
Tồn cabin hiện tại
= Tồn cabin ban đầu
+ NCC thực nhận
- Đã fill vào máy
+ Điều chỉnh cabin
```

Ví dụ:
- App tính Pepsi D3 còn 18.
- Kiểm kê thực tế còn 16.
- Nhập điều chỉnh: `-2`, lý do `Đếm lại`.

Không sửa trực tiếp số tồn cabin để tránh mất lịch sử.

Có Sửa / Xóa / Hoàn tác cho:
- Fill
- NCC
- Điều chỉnh cabin


## Bản V3 - Chặn cabin âm và đối chiếu kiểm kê

### Thay đổi chính

- Cabin không còn hiển thị số âm.
- Nếu công thức ra âm, app hiển thị 0 và báo lệch.
- Thêm màn hình `Kiểm tra`.
- Thêm chức năng `Đối chiếu kiểm kê`.

### Logic

Tồn cabin tính toán vẫn là:

```text
Tồn ban đầu + NCC thực nhận - Fill + Điều chỉnh
```

Nếu kết quả nhỏ hơn 0:

```text
Hiển thị = 0
Cảnh báo = lệch số lượng
```

### Cách sửa cabin âm

Vào `Kiểm tra`:
- Nếu thấy cảnh báo âm, bấm `Tạo điều chỉnh`.
- Hoặc nhập tồn thực tế ở phần `Đối chiếu kiểm kê`.

Ví dụ:
- App hiển thị 0 nhưng báo lệch 8.
- Kiểm kê thực tế còn 3.
- Nhập tồn thực tế 3.
- App tự tạo điều chỉnh phù hợp.
