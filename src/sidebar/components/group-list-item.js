'use strict';

const propTypes = require('prop-types');
const { Fragment, createElement } = require('preact');
const { useState } = require('preact/hooks');

const useStore = require('../store/use-store');
const { orgName } = require('../util/group-list-item-common');
const { withServices } = require('../util/service-context');

const MenuItem = require('./menu-item');

/**
 * An item in the groups selection menu.
 *
 * The item has a primary action which selects the group, along with a set of
 * secondary actions accessible via a toggle menu.
 */
function GroupListItem({
  analytics,
  defaultSubmenuOpen = false,
  group,
  groups: groupsService,
}) {
  const canLeaveGroup = group.type === 'private';
  const activityUrl = group.links.html;
  const hasActionMenu = activityUrl || canLeaveGroup;
  const isSelectable = !group.scopes.enforced || group.isScopedToUri;

  const [isExpanded, setExpanded] = useState(
    hasActionMenu ? defaultSubmenuOpen : undefined
  );
  const focusedGroupId = useStore(store => store.focusedGroupId());
  const isSelected = group.id === focusedGroupId;

  const actions = useStore(store => ({
    clearDirectLinkedGroupFetchFailed: store.clearDirectLinkedGroupFetchFailed,
    clearDirectLinkedIds: store.clearDirectLinkedIds,
    focusGroup: store.focusGroup,
  }));

  const focusGroup = () => {
    analytics.track(analytics.events.GROUP_SWITCH);
    actions.clearDirectLinkedGroupFetchFailed();
    actions.clearDirectLinkedIds();
    actions.focusGroup(group.id);
  };

  const leaveGroup = () => {
    const message = `Are you sure you want to leave the group "${group.name}"?`;
    if (window.confirm(message)) {
      analytics.track(analytics.events.GROUP_LEAVE);
      groupsService.leave(group.id);
    }
  };

  const toggleSubmenu = event => {
    event.stopPropagation();

    // Prevents group items opening a new window when clicked.
    // TODO - Fix this more cleanly in `MenuItem`.
    event.preventDefault();

    setExpanded(!isExpanded);
  };

  // Close the submenu when any clicks happen which close the top-level menu.
  const collapseSubmenu = () => setExpanded(false);

  return (
    <Fragment>
      <MenuItem
        icon={group.logo || null}
        iconAlt={orgName(group)}
        isDisabled={!isSelectable}
        isExpanded={isExpanded}
        isSelected={isSelected}
        isSubmenuVisible={isExpanded}
        label={group.name}
        onClick={isSelectable ? focusGroup : toggleSubmenu}
        onToggleSubmenu={toggleSubmenu}
      />
      {isExpanded && (
        <Fragment>
          <ul onClick={collapseSubmenu}>
            {activityUrl && (
              <li>
                <MenuItem
                  href={activityUrl}
                  icon="share"
                  isSubmenuItem={true}
                  label="View group activity"
                />
              </li>
            )}
            {canLeaveGroup && (
              <li>
                <MenuItem
                  icon="leave"
                  isSubmenuItem={true}
                  label="Leave group"
                  onClick={leaveGroup}
                />
              </li>
            )}
          </ul>
          {!isSelectable && (
            <p className="group-list-item__footer">
              This group is restricted to specific URLs.
            </p>
          )}
        </Fragment>
      )}
    </Fragment>
  );
}

GroupListItem.propTypes = {
  group: propTypes.object.isRequired,

  /** Whether the submenu is open when the item is initially rendered. */
  defaultSubmenuOpen: propTypes.bool,

  // Injected services.
  analytics: propTypes.object.isRequired,
  groups: propTypes.object.isRequired,
};

GroupListItem.injectedProps = ['analytics', 'groups'];

module.exports = withServices(GroupListItem);
