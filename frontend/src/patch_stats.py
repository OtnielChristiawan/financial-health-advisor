with open('App.jsx', 'rb') as f:
    content = f.read()

# search for the pattern as bytes
old_bytes = b'</div></article>)}</section>;'
idx = content.find(old_bytes)
print('Pattern found at byte offset:', idx)
if idx >= 0:
    print('Context:', content[max(0,idx-100):idx+60])
else:
    # Try partial pattern
    idx2 = content.find(b'</article>)}</section>')
    print('Partial at:', idx2)
    if idx2 >= 0:
        print(content[max(0,idx2-200):idx2+60])
    # Try even simpler
    idx3 = content.find(b'stat-card')
    print('stat-card at:', idx3)
    idx4 = content.find(b'stat-value')
    print('stat-value at:', idx4)
    idx5 = content.find(b'stat-foot')
    print('stat-foot at:', idx5)
    if idx5 >= 0:
        print(content[idx5:idx5+200])
