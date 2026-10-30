package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.Region;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RegionRepository extends JpaRepository<Region, Long> {

    List<Region> findAllByOrderBySidoNameAscSigunguNameAscRegionCodeAsc();
}
