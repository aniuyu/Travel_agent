with open('sub_projects/agent-chat-ui/src/app/workspace/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()
start = None
end = len(lines)
for i, l in enumerate(lines):
    if l.startswith('function TripDetailPanel') and start is None:
        start = i
    elif l.startswith('function TripsPanel'):
        end = i
        break
print(f'TripDetailPanel: lines {start+1} to {end+1}')
print('Last 12 lines:')
for i in range(end-12, end):
    print(f'{i+1:4d}: {lines[i].rstrip()}')