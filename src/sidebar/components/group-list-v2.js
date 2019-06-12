'use strict';

const { createElement } = require('preact');
const { useMemo } = require('preact/hooks');
const propTypes = require('prop-types');

const isThirdPartyService = require('../util/is-third-party-service');
const { isThirdPartyUser } = require('../util/account-id');
const groupsByOrganization = require('../util/group-organizations');
const useStore = require('../store/use-store');
const { withServices } = require('../util/service-context');
const serviceConfig = require('../service-config');

const Menu = require('./menu');
const MenuItem = require('./menu-item');
const GroupListSection = require('./group-list-section');

/**
 * Return the custom icon for the top bar configured by the publisher in
 * the Hypothesis client configuration.
 */
function publisherProvidedIcon(settings) {
  const svc = serviceConfig(settings);
  return svc && svc.icon ? svc.icon : null;
}

/**
 * Menu allowing the user to select which group to show and also access
 * additional actions related to groups.
 */
function GroupList({ serviceUrl, settings }) {
  const currentGroups = useStore(store => store.getCurrentlyViewingGroups());
  const featuredGroups = useStore(store => store.getFeaturedGroups());
  const myGroups = useStore(store => store.getMyGroups());
  const focusedGroup = useStore(store => store.focusedGroup());
  const userid = useStore(store => store.profile().userid);

  const myGroupsSorted = useMemo(() => groupsByOrganization(myGroups), [
    myGroups,
  ]);

  const featuredGroupsSorted = useMemo(
    () => groupsByOrganization(featuredGroups),
    [featuredGroups]
  );

  const currentGroupsSorted = useMemo(
    () => groupsByOrganization(currentGroups),
    [currentGroups]
  );

  const { authDomain } = settings;
  const canCreateNewGroup = userid && !isThirdPartyUser(userid, authDomain);
  const newGroupLink = serviceUrl('groups.new');

  let label;
  if (focusedGroup) {
    const icon = focusedGroup.organization.logo;
    label = (
      <span>
        <img
          className="group-list-label__icon group-list-label__icon--organization"
          src={icon || publisherProvidedIcon(settings)}
        />
        <span className="group-list-label__label">{focusedGroup.name}</span>
      </span>
    );
  } else {
    label = <span>…</span>;
  }

  // If there is only one group and no actions available for that group,
  // just show the group name as a label.
  const actionsAvailable = !isThirdPartyService(settings);
  if (
    !actionsAvailable &&
    currentGroups.length + featuredGroups.length + myGroups.length < 2
  ) {
    return label;
  }

  return (
    <Menu
      align="left"
      contentClass="group-list-v2__content"
      label={label}
      title="Select group"
    >
      {currentGroupsSorted.length > 0 && (
        <GroupListSection
          heading="Currently Viewing"
          groups={currentGroupsSorted}
        />
      )}
      {featuredGroupsSorted.length > 0 && (
        <GroupListSection
          heading="Featured Groups"
          groups={featuredGroupsSorted}
        />
      )}
      {myGroupsSorted.length > 0 && (
        <GroupListSection heading="My Groups" groups={myGroupsSorted} />
      )}

      {canCreateNewGroup && (
        <MenuItem
          icon="add-group"
          href={newGroupLink}
          label="New private group"
          style="shaded"
        />
      )}
    </Menu>
  );
}

GroupList.propTypes = {
  serviceUrl: propTypes.func,
  settings: propTypes.object,
};

GroupList.injectedProps = ['serviceUrl', 'settings'];

module.exports = withServices(GroupList);
