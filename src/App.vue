<script setup lang="ts">
import { fetchModels, testChannel as testApiChannel } from '@/api/client';
import { rewriteCurrentFloor, type RewriteChange } from '@/api/rewrite';
import { penSettings, type QuickPhrase } from '@/api/settings';
import {
  bookUpdatePromptOpen,
  canEditChannels,
  channels,
  newChannel,
  performBookUpdate,
  removeSharedChannel,
  requestBookUpdate,
  saveSharedChannel,
  sharingState,
  type ApiChannel,
} from '@/api/sharedChannels';
import Collapsible from '@/components/Collapsible.vue';
import Icon from '@/components/Icon.vue';
import ModalMask from '@/components/ModalMask.vue';
import {
  closePen,
  cycleTheme,
  applyParagraphReplacements,
  lastOpenedAt,
  modalHost,
  THEMES,
  ui,
} from '@/state/ui';
import { getContext } from '@/st/context';
import { PLUGIN_VERSION } from '@/version';
import { computed, ref, watch } from 'vue';

const expandedId = ref<number | null>(null);
const selectedChannelId = ref('');
const contextRounds = ref(1);
const generalNote = ref('');
const globalPhraseIds = ref<number[]>([]);
const customNote = ref('');
const showKey = ref(false);
const channelDraft = ref<ApiChannel | null>(null);
const phraseDraft = ref<QuickPhrase | null>(null);
const testMessage = ref('');
const modelOptions = ref<string[]>([]);
const toastText = ref('');
const markedPhrases = ref<Record<number, number[]>>({});
const paragraphNotes = ref<Record<number, string>>({});
const rewriteChanges = ref<RewriteChange[]>([]);
const reviewDecision = ref<Record<number, 'accept' | 'reject'>>({});
const generationError = ref('');
const generating = ref(false);
const contextSummary = ref('');
let requestController: AbortController | null = null;

const phrases = computed(() =>
  [...penSettings.phrases].sort((left, right) => Number(right.favorite) - Number(left.favorite)),
);
const markedCount = computed(() => ui.paragraphs.filter(paragraph => isMarked(paragraph.id)).length);
const hasInstructions = computed(
  () =>
    markedCount.value > 0 ||
    !!generalNote.value.trim() ||
    globalPhraseIds.value.length > 0,
);
const nextTheme = computed(() => {
  const index = THEMES.findIndex(theme => theme.value === ui.theme);
  return THEMES[(index + 1) % THEMES.length];
});
const reviewRows = computed(() =>
  rewriteChanges.value.map(change => ({
    id: change.paragraph,
    original: ui.paragraphs[change.paragraph - 1]?.text ?? '',
    result: change.replacement,
    deleted: change.replacement === '',
    marked: isMarked(change.paragraph),
  })),
);
const acceptedCount = computed(
  () => rewriteChanges.value.filter(change => reviewDecision.value[change.paragraph] === 'accept').length,
);

watch(
  () => ui.sessionRevision,
  () => {
    markedPhrases.value = {};
    paragraphNotes.value = {};
    expandedId.value = null;
    customNote.value = '';
    generalNote.value = '';
    globalPhraseIds.value = [];
    rewriteChanges.value = [];
    reviewDecision.value = {};
    generationError.value = '';
    contextSummary.value = '';
    contextRounds.value = penSettings.defaultContextRounds;
    selectedChannelId.value =
      penSettings.defaultChannelId &&
      channels.some(channel => channel.id === penSettings.defaultChannelId)
        ? penSettings.defaultChannelId
        : '';
    ui.stage = 'annotate';
  },
  { immediate: true },
);

watch(
  () => channels.map(channel => channel.id),
  ids => {
    if (selectedChannelId.value && !ids.includes(selectedChannelId.value)) {
      selectedChannelId.value = '';
    }
    if (penSettings.defaultChannelId && !ids.includes(penSettings.defaultChannelId)) {
      penSettings.defaultChannelId = '';
    }
  },
);

watch(
  () => penSettings.defaultContextRounds,
  value => {
    const normalized = Math.min(10, Math.max(0, Math.floor(Number(value) || 0)));
    if (value !== normalized) penSettings.defaultContextRounds = normalized;
  },
);

function isMarked(id: number): boolean {
  return (markedPhrases.value[id] ?? []).length > 0 || !!paragraphNotes.value[id]?.trim();
}

function markedNames(id: number): string[] {
  return (markedPhrases.value[id] ?? [])
    .map(phraseId => penSettings.phrases.find(phrase => phrase.id === phraseId)?.name)
    .filter((name): name is string => !!name);
}

function toggleExpand(id: number): void {
  if (ui.stage !== 'annotate' || generating.value) return;
  saveNote();
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
  customNote.value = paragraphNotes.value[id] ?? '';
}

function saveNote(): void {
  if (expandedId.value == null) return;
  paragraphNotes.value[expandedId.value] = customNote.value;
}

function togglePhrase(paragraphId: number, phraseId: number): void {
  const list =
    markedPhrases.value[paragraphId] ??
    (markedPhrases.value[paragraphId] = []);
  const index = list.indexOf(phraseId);
  if (index >= 0) list.splice(index, 1);
  else list.push(phraseId);
}

function toggleGlobalPhrase(phraseId: number): void {
  const index = globalPhraseIds.value.indexOf(phraseId);
  if (index >= 0) globalPhraseIds.value.splice(index, 1);
  else globalPhraseIds.value.push(phraseId);
}

function clearMark(id: number): void {
  markedPhrases.value[id] = [];
  paragraphNotes.value[id] = '';
  if (expandedId.value === id) customNote.value = '';
}

function phraseInstruction(id: number): string {
  return penSettings.phrases.find(phrase => phrase.id === id)?.instruction ?? '';
}

function rememberSelectedChannel(): void {
  penSettings.defaultChannelId = selectedChannelId.value;
}

async function startReview(): Promise<void> {
  if (generating.value) return;
  saveNote();
  if (!hasInstructions.value) {
    showToast('请先添加段落标注或整体要求');
    return;
  }
  if (ui.floor == null || !ui.originalText.trim()) {
    showToast('当前楼层不可用');
    return;
  }
  contextRounds.value = Math.min(10, Math.max(0, Math.floor(Number(contextRounds.value) || 0)));

  generationError.value = '';
  contextSummary.value = '';
  generating.value = true;
  requestController = new AbortController();
  try {
    const result = await rewriteCurrentFloor({
      floor: ui.floor,
      originalText: ui.originalText,
      contextRounds: contextRounds.value,
      channel: selectedChannelId.value
        ? channels.find(channel => channel.id === selectedChannelId.value) ?? null
        : null,
      signal: requestController.signal,
      generalInstructions: [
        ...globalPhraseIds.value.map(phraseInstruction),
        generalNote.value,
      ].filter(Boolean),
      annotations: ui.paragraphs
        .filter(paragraph => isMarked(paragraph.id))
        .map(paragraph => ({
          paragraph: paragraph.id,
          text: paragraph.text,
          instructions: [
            ...(markedPhrases.value[paragraph.id] ?? []).map(phraseInstruction),
            paragraphNotes.value[paragraph.id] ?? '',
          ].filter(Boolean),
        })),
    });
    rewriteChanges.value = result.changes;
    reviewDecision.value = Object.fromEntries(
      result.changes.map(change => [change.paragraph, 'accept' as const]),
    );
    contextSummary.value = [
      `历史消息 ${result.historyMessageCount} 条`,
      result.contextParts.charCard ? '角色设定' : '',
      result.contextParts.persona ? '用户设定' : '',
      result.contextParts.worldInfo ? '世界书' : '',
    ].filter(Boolean).join(' · ');
    expandedId.value = null;
    ui.stage = 'review';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      showToast('已取消生成');
    } else {
      generationError.value = error instanceof Error ? error.message : String(error);
      showToast('生成失败');
    }
  } finally {
    generating.value = false;
    requestController = null;
  }
}

function cancelGeneration(): void {
  requestController?.abort();
}

function backToAnnotate(): void {
  if (generating.value) return;
  ui.stage = 'annotate';
}

function finishReview(): void {
  if (generating.value) return;
  if (ui.floor == null || !rewriteChanges.value.length) return;
  if (acceptedCount.value === 0) {
    closePen();
    toastr?.info?.('已丢弃全部改写结果，编辑区未发生变化', '柏宝砚');
    return;
  }
  const context = getContext();
  if (ui.chatId && context?.getCurrentChatId?.() !== ui.chatId) {
    showToast('当前聊天已经切换，不能应用结果');
    return;
  }
  const editor = document.querySelector<HTMLTextAreaElement>(
    `#chat .mes[mesid="${ui.floor}"] #curEditTextarea`,
  );
  if (!editor) {
    showToast('当前楼层已退出编辑，不能应用结果');
    return;
  }
  if (editor.value !== ui.originalText) {
    showToast('编辑区内容已经变化，请重新打开砚');
    return;
  }
  const accepted = new Map(
    rewriteChanges.value
      .filter(change => reviewDecision.value[change.paragraph] === 'accept')
      .map(change => [change.paragraph, change.replacement] as const),
  );
  editor.value = applyParagraphReplacements(ui.originalText, accepted);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  closePen();
  toastr?.info?.('改写结果已写入编辑区，请使用 ST 的保存按钮确认', '柏宝砚');
}

function showToast(message: string): void {
  toastText.value = message;
  window.setTimeout(() => {
    if (toastText.value === message) toastText.value = '';
  }, 2200);
}

const excludeParamsText = computed<string>({
  get: () => channelDraft.value?.excludeParams.join(', ') ?? '',
  set: value => {
    if (!channelDraft.value) return;
    channelDraft.value.excludeParams = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  },
});

function openChannel(channel?: ApiChannel): void {
  if (!sharingState.ready) {
    showToast('渠道正在载入');
    return;
  }
  if (!canEditChannels()) {
    requestBookUpdate();
    return;
  }
  testMessage.value = '';
  modelOptions.value = [];
  showKey.value = false;
  channelDraft.value = channel
    ? JSON.parse(JSON.stringify(channel))
    : newChannel();
}

function saveChannel(): void {
  if (!channelDraft.value) return;
  if (!channelDraft.value.name.trim()) {
    showToast('请填写渠道名');
    return;
  }
  saveSharedChannel(channelDraft.value);
  selectedChannelId.value = channelDraft.value.id;
  rememberSelectedChannel();
  channelDraft.value = null;
  showToast('渠道已保存');
}

function removeChannel(): void {
  if (!channelDraft.value) return;
  removeSharedChannel(channelDraft.value.id);
  channelDraft.value = null;
  selectedChannelId.value = channels[0]?.id ?? '';
  rememberSelectedChannel();
  showToast('渠道已删除');
}

async function testChannel(): Promise<void> {
  if (!channelDraft.value) return;
  testMessage.value = '测试中…';
  const result = await testApiChannel(channelDraft.value);
  testMessage.value = result.message;
}

async function loadModels(): Promise<void> {
  if (!channelDraft.value) return;
  testMessage.value = '正在拉取模型…';
  try {
    modelOptions.value = await fetchModels(channelDraft.value);
    if (!channelDraft.value.model && modelOptions.value[0]) {
      channelDraft.value.model = modelOptions.value[0];
    }
    testMessage.value = modelOptions.value.length
      ? `已获取 ${modelOptions.value.length} 个模型`
      : '接口没有返回可用模型';
  } catch (error) {
    testMessage.value = error instanceof Error ? error.message : String(error);
  }
}

function openPhrase(phrase?: QuickPhrase): void {
  phraseDraft.value = phrase
    ? JSON.parse(JSON.stringify(phrase))
    : { id: Date.now(), name: '', instruction: '', favorite: false };
}

function savePhrase(): void {
  if (!phraseDraft.value?.name.trim() || !phraseDraft.value.instruction.trim()) {
    showToast('请填写名称和指令');
    return;
  }
  const index = penSettings.phrases.findIndex(phrase => phrase.id === phraseDraft.value?.id);
  if (index >= 0) penSettings.phrases[index] = phraseDraft.value;
  else penSettings.phrases.push(phraseDraft.value);
  phraseDraft.value = null;
  showToast('快捷语句已保存');
}

function removePhrase(): void {
  if (!phraseDraft.value) return;
  const index = penSettings.phrases.findIndex(phrase => phrase.id === phraseDraft.value?.id);
  if (index >= 0) penSettings.phrases.splice(index, 1);
  phraseDraft.value = null;
}

let pressedOnOverlay = false;

function onOverlayPointerDown(event: PointerEvent): void {
  pressedOnOverlay = event.target === event.currentTarget;
}

function onOverlayClick(event: MouseEvent): void {
  const justOpened = performance.now() - lastOpenedAt < 350;
  if (!justOpened && pressedOnOverlay && event.target === event.currentTarget && !generating.value) {
    closePen();
  }
  pressedOnOverlay = false;
}
</script>

<template>
  <div class="bby-root" :data-theme="ui.theme">
    <div ref="modalHost"></div>
    <Transition name="bby-fade">
      <div
        v-if="ui.open"
        class="bby-overlay"
        tabindex="-1"
        @pointerdown="onOverlayPointerDown"
        @click="onOverlayClick"
        @keydown.esc="!generating && closePen()"
      >
        <section class="bby-window" role="dialog" aria-modal="true" aria-label="柏宝砚">
          <div class="bby-mobile-grabber"><span></span></div>

          <header class="bby-header">
            <span class="bby-brand-name">柏宝砚</span>
            <div class="bby-header-actions">
              <button class="bby-icon-button" type="button" :title="`切换主题：${nextTheme.label}`" @click="cycleTheme">
                <Icon :name="nextTheme.icon" />
              </button>
              <button class="bby-icon-button" type="button" title="关闭" :disabled="generating" @click="closePen">
                <Icon name="close" />
              </button>
            </div>
          </header>

          <nav class="bby-main-nav" aria-label="主导航">
            <button type="button" :class="{ 'is-active': ui.page === 'workspace' }" @click="ui.page = 'workspace'">
              <Icon name="workspace" /> 工作台
            </button>
            <button type="button" :class="{ 'is-active': ui.page === 'settings' }" @click="ui.page = 'settings'">
              <Icon name="settings" /> 设置
            </button>
          </nav>

          <Transition name="bby-page" mode="out-in">
            <div v-if="ui.page === 'workspace'" key="workspace" class="bby-page-shell">
              <div class="bby-doc-bar">
                <div class="bby-floor-meta">
                  <span class="bby-floor-number">{{ ui.floorLabel }}</span>
                  <strong>{{ ui.speaker }}</strong>
                  <span>当前编辑区</span>
                </div>
                <div class="bby-doc-status">
                  <span v-if="ui.stage === 'annotate'">已标注 <b>{{ markedCount }}</b> 段</span>
                  <template v-else>
                    <span>AI 建议 <b>{{ reviewRows.length }}</b> 段 · 已选 <b>{{ acceptedCount }}</b> 段</span>
                    <button class="bby-text-action" type="button" @click="backToAnnotate">
                      <Icon name="undo" /> 返回标注
                    </button>
                  </template>
                </div>
              </div>

              <main v-if="ui.stage === 'annotate'" class="bby-document" aria-label="楼层全文">
                <section class="bby-general-editor">
                  <div class="bby-para-editor-head">
                    <span>整体要求</span>
                    <span class="bby-context-label">上下文 {{ contextRounds }} 轮</span>
                  </div>
                  <div v-if="phrases.length" class="bby-phrase-picker">
                    <button
                      v-for="phrase in phrases"
                      :key="phrase.id"
                      type="button"
                      :class="{ 'is-selected': globalPhraseIds.includes(phrase.id) }"
                      @click="toggleGlobalPhrase(phrase.id)"
                    >
                      <Icon v-if="globalPhraseIds.includes(phrase.id)" name="check" />
                      {{ phrase.name }}
                    </button>
                  </div>
                  <textarea
                    v-model="generalNote"
                    class="bby-input bby-general-note"
                    placeholder="可选：填写作用于当前楼层全文的要求"
                  ></textarea>
                  <div class="bby-context-control">
                    <label>
                      <span>携带上下文轮数</span>
                      <input v-model.number="contextRounds" class="bby-input" type="number" min="0" max="10" step="1" />
                    </label>
                    <span>一轮为上一条 AI 消息及其后的用户输入</span>
                  </div>
                </section>

                <article
                  v-for="paragraph in ui.paragraphs"
                  :key="paragraph.id"
                  class="bby-para"
                  :class="{
                    'is-open': expandedId === paragraph.id,
                    'is-marked': isMarked(paragraph.id),
                  }"
                >
                  <button
                    class="bby-para-text"
                    type="button"
                    :disabled="generating"
                    @click="toggleExpand(paragraph.id)"
                  >
                    {{ paragraph.text }}
                  </button>

                  <div v-if="expandedId !== paragraph.id && isMarked(paragraph.id)" class="bby-para-tags">
                    <span v-for="name in markedNames(paragraph.id)" :key="name" class="bby-tag">{{ name }}</span>
                    <span v-if="paragraphNotes[paragraph.id]?.trim()" class="bby-tag">+ 补充要求</span>
                  </div>

                  <Transition name="bby-expand">
                    <div v-if="expandedId === paragraph.id" class="bby-para-editor">
                      <div class="bby-para-editor-head">
                        <span>改写要求</span>
                        <button class="bby-icon-mini bby-danger-hover" type="button" title="清除本段标注" @click="clearMark(paragraph.id)">
                          <Icon name="trash" />
                        </button>
                      </div>
                      <div v-if="phrases.length" class="bby-phrase-picker">
                        <button
                          v-for="phrase in phrases"
                          :key="phrase.id"
                          type="button"
                          :class="{ 'is-selected': (markedPhrases[paragraph.id] ?? []).includes(phrase.id) }"
                          @click="togglePhrase(paragraph.id, phrase.id)"
                        >
                          <Icon v-if="(markedPhrases[paragraph.id] ?? []).includes(phrase.id)" name="check" />
                          {{ phrase.name }}
                        </button>
                      </div>
                      <textarea
                        v-model="customNote"
                        class="bby-input bby-note"
                        placeholder="填写希望如何修改这一段"
                        @blur="saveNote"
                      ></textarea>
                      <button class="bby-text-action" type="button" @click="ui.page = 'settings'">
                        <Icon name="settings" /> 管理快捷语句
                      </button>
                    </div>
                  </Transition>
                </article>

                <p v-if="generationError" class="bby-error-message">{{ generationError }}</p>
              </main>

              <main v-else class="bby-document bby-review-document" aria-label="改写结果">
                <p v-if="contextSummary" class="bby-context-summary">{{ contextSummary }}</p>
                <p v-if="generationError" class="bby-error-message">{{ generationError }}</p>
                <div
                  v-for="row in reviewRows"
                  :key="row.id"
                  class="bby-review-row"
                  :class="{ 'is-rejected': reviewDecision[row.id] === 'reject' }"
                >
                  <div class="bby-review-row-head">
                    <span class="bby-floor-number">#P{{ row.id }}</span>
                    <span class="bby-tag">{{ row.deleted ? '删除段落' : row.marked ? '标注段落' : '关联调整' }}</span>
                  </div>
                  <div class="bby-review-columns">
                    <div>
                      <span class="bby-review-label">原文</span>
                      <p>{{ row.original }}</p>
                    </div>
                    <div>
                      <span class="bby-review-label">改写结果</span>
                      <p :class="{ 'bby-deleted-text': row.deleted }">{{ row.deleted ? '（删除整段）' : row.result }}</p>
                    </div>
                  </div>
                  <div class="bby-decide">
                    <button
                      type="button"
                      :class="{ 'is-active': reviewDecision[row.id] === 'reject' }"
                      @click="reviewDecision[row.id] = 'reject'"
                    >
                      丢弃本段
                    </button>
                    <button
                      type="button"
                      :class="{ 'is-active': reviewDecision[row.id] === 'accept' }"
                      @click="reviewDecision[row.id] = 'accept'"
                    >
                      应用本段
                    </button>
                  </div>
                </div>
              </main>

              <footer class="bby-action-bar">
                <div class="bby-channel-select">
                  <span>改写渠道</span>
                  <select v-model="selectedChannelId" class="bby-input bby-select" @change="rememberSelectedChannel">
                    <option value="">跟随主 API</option>
                    <option v-for="channel in channels" :key="channel.id" :value="channel.id">
                      {{ channel.name }} · {{ channel.model }}
                    </option>
                  </select>
                </div>
                <div class="bby-action-buttons">
                  <button v-if="generating" class="bby-button" type="button" @click="cancelGeneration">
                    取消
                  </button>
                  <button
                    v-if="ui.stage === 'annotate'"
                    class="bby-button bby-primary bby-btn-sm"
                    type="button"
                    :disabled="generating || !hasInstructions"
                    @click="startReview"
                  >
                    <Icon :name="generating ? 'refresh' : 'bolt'" :class="{ 'bby-spin': generating }" />
                    {{ generating ? '生成中…' : '生成' }}
                  </button>
                  <template v-else>
                    <button class="bby-button bby-btn-sm" type="button" :disabled="generating" @click="startReview">
                      <Icon name="refresh" :class="{ 'bby-spin': generating }" /> 重新生成
                    </button>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" :disabled="generating" @click="finishReview">
                      <Icon :name="acceptedCount === 0 ? 'trash' : 'check'" />
                      {{ acceptedCount === 0 ? '丢弃全部' : `应用 ${acceptedCount} 段` }}
                    </button>
                  </template>
                </div>
              </footer>
            </div>

            <main v-else key="settings" class="bby-settings bby-page-shell">
              <header class="bby-settings-page-head">
                <h2>设置</h2>
                <span class="bby-ver">v{{ PLUGIN_VERSION }}</span>
              </header>

              <div class="bby-settings-sections">
                <Collapsible title="改写">
                  <label class="bby-modal-field">
                    <span class="bby-modal-label">默认渠道</span>
                    <select v-model="penSettings.defaultChannelId" class="bby-input bby-select">
                      <option value="">跟随主 API</option>
                      <option v-for="channel in channels" :key="channel.id" :value="channel.id">
                        {{ channel.name }} · {{ channel.model }}
                      </option>
                    </select>
                  </label>
                  <label class="bby-modal-field bby-setting-gap">
                    <span class="bby-modal-label">默认上下文轮数</span>
                    <input v-model.number="penSettings.defaultContextRounds" class="bby-input" type="number" min="0" max="10" step="1" />
                    <span class="bby-field-hint">每轮包含上一条 AI 消息和紧随其后的用户输入。</span>
                  </label>
                </Collapsible>

                <Collapsible title="副 API">
                  <div v-if="sharingState.mode === 'legacy-readonly'" class="bby-channel-compat">
                    <p class="bby-field-hint">
                      检测到旧版柏宝书{{ sharingState.bookVersion ? ` v${sharingState.bookVersion}` : '' }}。更新到 v1.1.3
                      后，两边即可共同编辑同一份渠道列表。
                    </p>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" @click="requestBookUpdate">
                      <Icon name="refresh" /> 更新柏宝书
                    </button>
                  </div>
                  <div class="bby-channel-bar">
                    <span class="bby-field-label">渠道</span>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" :disabled="!canEditChannels()" @click="openChannel()">
                      <Icon name="plus" /> 添加渠道
                    </button>
                  </div>
                  <ul v-if="channels.length" class="bby-channel-list">
                    <li v-for="channel in channels" :key="channel.id" class="bby-channel-item">
                      <button class="bby-channel-open" type="button" @click="openChannel(channel)">
                        <span class="bby-channel-name">{{ channel.name || '未命名渠道' }}</span>
                        <span class="bby-channel-model">{{ channel.model || '未设模型' }}</span>
                      </button>
                    </li>
                  </ul>
                  <p v-else-if="!sharingState.ready" class="bby-field-hint">正在载入渠道…</p>
                  <p v-else class="bby-field-hint">还没有渠道。可以添加副 API，或直接跟随主 API。</p>
                </Collapsible>

                <Collapsible title="快捷语句">
                  <div class="bby-section-action">
                    <span class="bby-field-label">标注模板</span>
                    <button class="bby-button bby-primary bby-btn-sm" type="button" @click="openPhrase()">
                      <Icon name="plus" /> 添加语句
                    </button>
                  </div>
                  <div v-if="phrases.length" class="bby-phrase-list">
                    <button v-for="phrase in phrases" :key="phrase.id" type="button" @click="openPhrase(phrase)">
                      <span class="bby-phrase-favorite" :class="{ 'is-on': phrase.favorite }">★</span>
                      <span>
                        <strong>{{ phrase.name }}</strong>
                        <small>{{ phrase.instruction }}</small>
                      </span>
                      <Icon name="chevron" />
                    </button>
                  </div>
                  <p v-else class="bby-field-hint">尚未添加快捷语句。</p>
                </Collapsible>

                <Collapsible title="界面">
                  <div class="bby-field">
                    <div class="bby-field-head"><span class="bby-field-label">主题</span></div>
                    <div class="bby-segmented bby-segmented-wrap">
                      <button
                        v-for="theme in THEMES"
                        :key="theme.value"
                        type="button"
                        class="bby-seg"
                        :class="{ 'is-on': ui.theme === theme.value }"
                        @click="ui.theme = theme.value"
                      >
                        <Icon :name="theme.icon" /> {{ theme.label }}
                      </button>
                    </div>
                  </div>
                </Collapsible>
              </div>
            </main>
          </Transition>

          <nav class="bby-mobile-nav" aria-label="移动端导航">
            <button :class="{ 'is-active': ui.page === 'workspace' }" type="button" @click="ui.page = 'workspace'">
              <Icon name="workspace" /><span>工作台</span>
            </button>
            <button :class="{ 'is-active': ui.page === 'settings' }" type="button" @click="ui.page = 'settings'">
              <Icon name="settings" /><span>设置</span>
            </button>
          </nav>
        </section>
      </div>
    </Transition>

    <ModalMask :open="!!channelDraft" @close="channelDraft = null">
      <div v-if="channelDraft" class="bby-modal" role="dialog" aria-modal="true" aria-label="编辑渠道">
        <header class="bby-modal-head">
          <span class="bby-modal-title">编辑渠道</span>
          <button class="bby-icon-mini" type="button" title="关闭" @click="channelDraft = null"><Icon name="close" /></button>
        </header>
        <label class="bby-modal-field">
          <span class="bby-modal-label">渠道名</span>
          <input v-model="channelDraft.name" class="bby-input" placeholder="渠道名" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">API 地址</span>
          <input v-model="channelDraft.url" class="bby-input" placeholder="如 https://api.openai.com/v1" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">API 密钥</span>
          <div class="bby-model-row">
            <input v-model="channelDraft.key" class="bby-input" :type="showKey ? 'text' : 'password'" placeholder="API 密钥" />
            <button class="bby-icon-mini" type="button" :title="showKey ? '隐藏密钥' : '显示密钥'" @click="showKey = !showKey">
              <Icon :name="showKey ? 'eyeOff' : 'eye'" />
            </button>
          </div>
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">模型</span>
          <div class="bby-model-row">
            <input v-model="channelDraft.model" list="bby-channel-model-options" class="bby-input" placeholder="模型名" />
            <datalist id="bby-channel-model-options">
              <option v-for="model in modelOptions" :key="model" :value="model"></option>
            </datalist>
            <button class="bby-icon-mini" type="button" title="拉取模型" @click="loadModels"><Icon name="refresh" /></button>
          </div>
        </label>
        <div class="bby-channel-row">
          <label class="bby-mini-field">
            <span>温度</span>
            <input v-model.number="channelDraft.temperature" class="bby-input" type="number" step="0.1" min="0" max="2" />
          </label>
          <label class="bby-mini-field">
            <span>最大 token</span>
            <input v-model.number="channelDraft.maxTokens" class="bby-input" type="number" step="256" min="256" />
          </label>
          <label class="bby-mini-field">
            <span>超时（秒）</span>
            <input v-model.number="channelDraft.timeoutSec" class="bby-input" type="number" step="10" min="1" />
          </label>
        </div>
        <label class="bby-switch-row">
          <span class="bby-modal-label">流式传输</span>
          <input v-model="channelDraft.stream" type="checkbox" class="bby-checkbox" />
        </label>
        <label class="bby-switch-row">
          <span class="bby-modal-label">发送预填充</span>
          <input v-model="channelDraft.prefill" type="checkbox" class="bby-checkbox" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">排除参数</span>
          <input v-model="excludeParamsText" class="bby-input" placeholder="逗号分隔，如 temperature, max_tokens" />
        </label>
        <p v-if="testMessage" class="bby-channel-test">{{ testMessage }}</p>
        <footer class="bby-modal-foot">
          <button class="bby-button bby-danger" type="button" @click="removeChannel"><Icon name="trash" /> 删除</button>
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button" type="button" @click="testChannel"><Icon name="plug" /> 测试渠道</button>
          <button class="bby-button bby-primary" type="button" @click="saveChannel">完成</button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="bookUpdatePromptOpen" @close="bookUpdatePromptOpen = false">
      <div class="bby-modal" role="dialog" aria-modal="true" aria-label="更新柏宝书">
        <header class="bby-modal-head">
          <span class="bby-modal-title">更新柏宝书</span>
          <button class="bby-icon-mini" type="button" title="关闭" @click="bookUpdatePromptOpen = false"><Icon name="close" /></button>
        </header>
        <p class="bby-field-hint">
          当前柏宝书{{ sharingState.bookVersion ? `版本为 v${sharingState.bookVersion}` : '版本无法确认' }}。需要更新到
          v1.1.3，才能与柏宝砚实时共用并编辑渠道。更新成功后页面会自动刷新，现有渠道会自动迁移。
        </p>
        <p v-if="sharingState.updateError" class="bby-channel-test">更新失败：{{ sharingState.updateError }}</p>
        <footer class="bby-modal-foot">
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button" type="button" :disabled="sharingState.updating" @click="bookUpdatePromptOpen = false">暂不更新</button>
          <button class="bby-button bby-primary" type="button" :disabled="sharingState.updating" @click="performBookUpdate">
            <Icon name="refresh" /> {{ sharingState.updating ? '更新中…' : '更新并刷新' }}
          </button>
        </footer>
      </div>
    </ModalMask>

    <ModalMask :open="!!phraseDraft" @close="phraseDraft = null">
      <div v-if="phraseDraft" class="bby-modal" role="dialog" aria-modal="true" aria-label="编辑快捷语句">
        <header class="bby-modal-head">
          <span class="bby-modal-title">编辑快捷语句</span>
          <button class="bby-icon-mini" type="button" title="关闭" @click="phraseDraft = null"><Icon name="close" /></button>
        </header>
        <label class="bby-modal-field">
          <span class="bby-modal-label">名称</span>
          <input v-model="phraseDraft.name" class="bby-input" placeholder="例如：增强情绪" />
        </label>
        <label class="bby-modal-field">
          <span class="bby-modal-label">指令</span>
          <textarea v-model="phraseDraft.instruction" class="bby-input bby-phrase-area"></textarea>
        </label>
        <label class="bby-switch-row">
          <span class="bby-modal-label">置顶显示</span>
          <input v-model="phraseDraft.favorite" type="checkbox" class="bby-checkbox" />
        </label>
        <footer class="bby-modal-foot">
          <button class="bby-button bby-danger" type="button" @click="removePhrase"><Icon name="trash" /> 删除</button>
          <span class="bby-modal-foot-spacer"></span>
          <button class="bby-button bby-primary" type="button" @click="savePhrase">完成</button>
        </footer>
      </div>
    </ModalMask>

    <Transition name="bby-toast">
      <div v-if="toastText" class="bby-toast">{{ toastText }}</div>
    </Transition>
  </div>
</template>
