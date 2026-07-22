import { openFloorPicker, openPen } from '@/state/ui';
import { getContext } from '@/st/context';

const MENU_ITEM_ID = 'bby-menu-item';

export function injectMenuButton(): void {
  const tryInject = () => {
    const menu = $('#extensionsMenu');
    if (menu.length === 0) return false;
    if ($(`#${MENU_ITEM_ID}`).length > 0) return true;

    const item = $(`
      <div class="extension_container interactable" tabindex="0">
        <a id="${MENU_ITEM_ID}" class="list-group-item" href="#" title="柏宝砚">
          <i class="fa-solid fa-pen-ruler"></i>
          <span>柏宝砚</span>
        </a>
      </div>
    `);

    item.on('click', (event: { preventDefault: () => void }) => {
      event.preventDefault();
      const editor = document.querySelector<HTMLTextAreaElement>('#curEditTextarea');
      const message = editor?.closest<HTMLElement>('.mes');
      const floor = Number(message?.getAttribute('mesid'));
      const context = getContext();
      const chatMessage = context?.chat?.[floor];
      if (editor && Number.isInteger(floor) && chatMessage) {
        // 正在编辑某条消息:直接对当前编辑区开砚
        openPen(
          editor.value,
          floor,
          message?.querySelector<HTMLElement>('.name_text')?.textContent?.trim() || chatMessage.name,
          context?.getCurrentChatId?.() ?? '',
        );
      } else {
        // 未在编辑态:先给楼层列表,选一楼后自动进入该楼编辑
        openFloorPicker();
      }
      $('#extensionsMenu').hide();
    });
    menu.append(item);
    return true;
  };

  if (tryInject()) return;
  const timer = window.setInterval(() => {
    if (tryInject()) window.clearInterval(timer);
  }, 500);
}
