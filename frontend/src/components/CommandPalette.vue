<template>
  <b-modal :active.sync="isOpen" :width="600" class="command-palette" scroll="clip">
    <div class="modal-card">
      <header class="modal-card-head p-3">
        <b-field class="mb-0" expanded>
          <b-input
            v-model="search"
            placeholder="Type a command or search..."
            icon="magnify"
            ref="input"
            @keyup.native.enter="onEnter"
          />
        </b-field>
      </header>
      <section class="modal-card-body p-0">
        <div class="list is-hoverable">
          <a
            v-for="(cmd, index) in filteredCommands"
            :key="cmd.label"
            class="list-item p-3 is-flex is-align-items-center"
            :class="{ 'is-active': index === activeIndex }"
            @click="execute(cmd)"
            @keyup.enter="execute(cmd)"
          >
            <b-icon :icon="cmd.icon" size="is-small" class="mr-3" />
            <span>{{ cmd.label }}</span>
            <span class="is-size-7 has-text-grey ml-auto">{{ cmd.shortcut }}</span>
          </a>
          <div v-if="filteredCommands.length === 0" class="p-5 has-text-centered has-text-grey">
            No commands found for "{{ search }}"
          </div>
        </div>
      </section>
    </div>
  </b-modal>
</template>

<script>
export default {
  data() {
    return {
      isOpen: false,
      search: '',
      activeIndex: 0,
      commands: [
        { label: 'Dashboard', icon: 'view-dashboard-variant-outline', route: 'dashboard' },
        { label: 'Campaigns', icon: 'rocket-launch-outline', route: 'campaigns' },
        { label: 'New Campaign', icon: 'plus', route: 'campaign', params: { id: 'new' } },
        { label: 'Subscribers', icon: 'account-multiple', route: 'subscribers' },
        { label: 'Lists', icon: 'format-list-bulleted-square', route: 'lists' },
        { label: 'Templates', icon: 'file-image-outline', route: 'templates' },
        { label: 'Media', icon: 'image-outline', route: 'media' },
        { label: 'Settings', icon: 'cog-outline', route: 'settings' },
        { label: 'Maintenance', icon: 'wrench-outline', route: 'maintenance' },
        { label: 'Logs', icon: 'format-list-bulleted-square', route: 'logs' },
      ],
    };
  },
  computed: {
    filteredCommands() {
      if (!this.search) return this.commands;
      const q = this.search.toLowerCase();
      return this.commands.filter((c) => c.label.toLowerCase().includes(q));
    },
  },
  methods: {
    toggle() {
      this.isOpen = !this.isOpen;
      if (this.isOpen) {
        this.search = '';
        this.activeIndex = 0;
        this.$nextTick(() => {
          if (this.$refs.input) this.$refs.input.focus();
        });
      }
    },
    execute(cmd) {
      this.isOpen = false;
      if (cmd.route) {
        this.$router.push({ name: cmd.route, params: cmd.params || {} });
      }
    },
    onEnter() {
      if (this.filteredCommands[this.activeIndex]) {
        this.execute(this.filteredCommands[this.activeIndex]);
      }
    },
  },
  mounted() {
    const handleKeydown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.toggle();
      }
      if (this.isOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.activeIndex = (this.activeIndex + 1) % this.filteredCommands.length;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.activeIndex = (this.activeIndex - 1 + this.filteredCommands.length) % this.filteredCommands.length;
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    this.$once('hook:beforeDestroy', () => {
      window.removeEventListener('keydown', handleKeydown);
    });
  },
};
</script>

<style lang="scss" scoped>
.command-palette {
  .modal-card {
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }
  .list-item {
    cursor: pointer;
    border-bottom: 1px solid var(--border-color);
    transition: background 0.2s;
    color: var(--text-main);

    &:last-child { border-bottom: 0; }
    &:hover, &.is-active {
      background: var(--bg-main);
      color: var(--primary);
    }
  }
}
</style>
