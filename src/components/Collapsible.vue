<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    open?: boolean;
  }>(),
  { open: false },
);

const expanded = ref(props.open);
</script>

<template>
  <section class="bby-collapsible" :class="{ 'is-open': expanded }">
    <button class="bby-collapsible-head" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
      <span>{{ title }}</span>
      <Icon name="chevron" class="bby-collapsible-chevron" />
    </button>
    <div class="bby-collapsible-outer">
      <div class="bby-collapsible-inner">
        <div class="bby-collapsible-body">
          <slot />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bby-collapsible {
  overflow: hidden;
  border: 1px solid var(--bby-line);
  border-radius: var(--bby-radius);
  background: var(--bby-surface);
}

.bby-collapsible-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  color: var(--bby-ink);
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  text-align: left;
  transition: background var(--bby-duration) var(--bby-ease);
}

.bby-collapsible-head:hover {
  background: var(--bby-surface-2);
}

.bby-collapsible-chevron {
  color: var(--bby-ink-muted);
  font-size: 18px;
  transition: transform var(--bby-duration) var(--bby-ease);
}

.bby-collapsible.is-open > .bby-collapsible-head .bby-collapsible-chevron {
  transform: rotate(180deg);
}

.bby-collapsible-outer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--bby-duration) var(--bby-ease);
}

.bby-collapsible.is-open > .bby-collapsible-outer {
  grid-template-rows: 1fr;
}

.bby-collapsible-inner {
  min-height: 0;
  overflow: hidden;
}

.bby-collapsible-body {
  padding: 14px 16px;
  border-top: 1px solid var(--bby-line);
}

@media (max-width: 640px) {
  .bby-collapsible-head {
    font-size: 13px;
  }
}
</style>
