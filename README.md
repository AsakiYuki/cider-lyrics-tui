# cider-lyrics-cli

CLI hiển thị lyrics đồng bộ với bài đang phát trong Cider. Dùng `cider-sdk`, nhận cập nhật playback qua Socket.IO/WebSocket và vẽ TUI trong alternate screen bằng Bun.

## Chạy

```sh
bun install
bun run start --auth
bun run start
```

Lệnh `--auth` mở hộp thoại cấp quyền của Cider và lưu token vào `~/.config/cider-lyrics/token` với quyền đọc/ghi riêng cho user. CLI cần scope `lyrics` để lấy lời và scope `playback` để đọc bài đang phát cùng vị trí hiện tại. Cider phải đang chạy trên máy.

Nếu token cũ chỉ có scope `lyrics`, chạy lại `bun run start --auth` để xin token mới có đủ hai scope.

CLI đọc timing từ TTML của Cider, không dùng mảng `words`. TUI render mỗi 10 ms; playback được đồng bộ mỗi 100 ms và nội suy giữa các mẫu. Ký tự trong mỗi word/span fade từ xám sang trắng theo timing, quét lần lượt từ trái sang phải. Voice có số chẵn được căn phải; background vocal xuất hiện cùng lúc với dòng chính, thụt xuống dưới và tiếp tục fade theo timing riêng đến hết câu hát. TUI hiển thị nhiều dòng theo chiều cao terminal; khi gap giữa hai dòng lyrics dài hơn một giây, nó chèn `Chờ . . .` vào khoảng giữa và pulse từng dấu chấm. Lấy token bằng biến môi trường cũng được:

```sh
CIDER_API_TOKEN=... bun run start
```

Đặt offset đồng bộ khi lời chạy sớm hoặc trễ. Offset tính bằng giây và được cộng vào vị trí playback khi hiển thị; số dương làm lyrics chạy sớm hơn, số âm làm trễ hơn:

```sh
bun run start --offset 0.25
bun run start --offset=-0.15
CIDER_LYRICS_OFFSET=0.25 bun run start
```

Xuất TTML Apple cho bài hiện tại ra stdout hoặc file:

```sh
bun run start --ttml > lyrics.ttml
bun run start --ttml lyrics.ttml
```

Đổi địa chỉ Cider API bằng `CIDER_URL` (mặc định `http://127.0.0.1:10767`).
