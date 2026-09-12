with open('sub_projects/agent-chat-ui/src/app/workspace/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 在 1249 行（0-idx 1248）`);` 之前插入 dialog
# 1248 是 </div>,，1249 是 );，1250 是 }
# 在 1249 行前插入
# dialog 缩进 6 空格（与return内的jsx对齐）
dialog_lines = [
    '\n',
    '      {/* 全屏地图弹窗 */}\n',
    '      {mapOpen && (\n',
    '        <div\n',
    '          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"\n',
    '          onClick={() => setMapOpen(false)}\n',
    '        >\n',
    '          <div\n',
    '            className="relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"\n',
    '            onClick={(e) => e.stopPropagation()}\n',
    '          >\n',
    '            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">\n',
    '              <div>\n',
    '                <h3 className="text-lg font-bold text-gray-800">🗺️ 行程地图 · 全屏查看</h3>\n',
    '                <p className="text-xs text-gray-500">拖动 / 缩放查看沿途细节 · 包含实时路况</p>\n',
    '              </div>\n',
    '              <button\n',
    '                onClick={() => setMapOpen(false)}\n',
    '                className="flex size-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition-colors hover:bg-gray-200"\n',
    '                aria-label="关闭"\n',
    '              >\n',
    '                ✕\n',
    '              </button>\n',
    '            </div>\n',
    '            <div\n',
    '              ref={dialogMapRef}\n',
    '              className="w-full bg-gray-100"\n',
    '              style={{ height: "70vh", minHeight: "480px" }}\n',
    '            />\n',
    '            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">\n',
    '              <div className="flex items-center gap-3 text-xs text-gray-500">\n',
    '                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">实时路况</span>\n',
    '                <span>· 红色 = 拥堵 · 黄色 = 缓行 · 绿色 = 畅通</span>\n',
    '              </div>\n',
    '              <a\n',
    '                href={\n',
    '                  trip?._tripData?.destination_geo\n',
    '                    ? `https://uri.amap.com/navigation?to=${trip._tripData.destination_geo.lng},${trip._tripData.destination_geo.lat},${encodeURIComponent(trip.destination)}&mode=0&coordinate=gaode&src=fytt`\n',
    '                    : "#"\n',
    '                }\n',
    '                target="_blank"\n',
    '                rel="noopener noreferrer"\n',
    '                className="rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"\n',
    '              >\n',
    '                🚗 跳转高德 App 导航\n',
    '              </a>\n',
    '            </div>\n',
    '          </div>\n',
    '        </div>\n',
    '      )}\n',
]

# 插入到 1248 行（0-idx 1248 = 第1249行 `);`）之前
insert_line_idx = 1248  # 第1249行是 `);`，在其前插入
new_lines = lines[:insert_line_idx] + dialog_lines + lines[insert_line_idx:]

with open('sub_projects/agent-chat-ui/src/app/workspace/page.tsx', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print('done, total lines:', len(new_lines))